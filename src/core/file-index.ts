// Asynchronous workspace file index backing fuzzy path completion (spec
// 2026-10-20, Part A "Workspace index"). Core-layer module: node builtins
// only, no host imports.
//
// A single in-memory slot caches the enumeration of one workspace root and
// is replaced wholesale when the queried root changes. The first query for
// a root starts one asynchronous build (child_process.spawn only, never
// spawnSync) and immediately returns the current snapshot, so TUI rendering
// never blocks on a child process. The enumeration chain is git ls-files,
// then fd, then a bounded recursive walk; the first success wins and the
// winning enumerator is memoized in the slot so refreshes skip re-probing.
// Entries older than 5000 ms are stale: stale entries keep being served
// while exactly one background refresh runs (stale-while-revalidate), so
// the slot state never flips back to "building" during a refresh.
//
// Errors never escape as unhandled rejections: spawn failures, non-zero
// exits, and filesystem errors all land in the slot state ("failed").
// Entries are stored in enumeration order; that order is the stable
// tiebreak source for fuzzy ranking.

import { spawn as nodeSpawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type IndexState = "building" | "ready" | "oversized" | "failed";
export type EnumeratorKind = "git" | "fd" | "walk";

// The single cache slot. enumerator memoizes the winning enumerator of the
// last successful build (null while building or failed); at is the build
// completion timestamp used for TTL staleness.
export interface FileIndexSlot {
  root: string;
  state: IndexState;
  entries: string[];
  enumerator: EnumeratorKind | null;
  at: number;
}

// Injectable seams for tests: the spawn primitive and the clock.
export interface FileIndexDeps {
  spawn: typeof nodeSpawn;
  now: () => number;
}

export interface IndexSnapshot {
  state: IndexState;
  entries: string[];
}

export interface FileIndex {
  // Returns the current snapshot for root and may start a build or a
  // single background refresh; it never blocks and never throws. The
  // entries array is the live cached list in enumeration order; treat it
  // as read-only.
  query(root: string): IndexSnapshot;
}

const STALE_MS = 5000;
const MAX_ENTRIES = 20000;
const MAX_DEPTH = 8;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build"]);

type SpawnOutput = { ok: true; out: Buffer } | { ok: false };
type EnumResult =
  | { ok: true; enumerator: EnumeratorKind; entries: string[] }
  | { ok: false };

// Runs one child process to completion, buffering stdout. A spawn error
// (e.g. ENOENT for a missing binary), a signal kill, or a non-zero exit
// resolves to { ok: false }; this promise never rejects.
function runProcess(io: FileIndexDeps, cmd: string, args: string[], cwd: string): Promise<SpawnOutput> {
  return new Promise((resolve) => {
    let settled = false;
    let out = Buffer.alloc(0);
    const finish = (result: SpawnOutput) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = io.spawn(cmd, args, { cwd });
      child.on("error", () => finish({ ok: false }));
      child.stdout?.on("data", (chunk: Buffer) => {
        out = Buffer.concat([out, chunk]);
      });
      child.on("close", (code) => finish(code === 0 ? { ok: true, out } : { ok: false }));
    } catch {
      resolve({ ok: false });
    }
  });
}

// Prepends every ancestor directory of the listed files, shallowest first,
// deduplicated across the list. Directory entries carry a trailing "/" so
// the index self-describes which candidates are directories; file entries
// keep git's relative path verbatim.
function withSyntheticDirs(files: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix += parts[i] + "/";
      if (!seen.has(prefix)) {
        seen.add(prefix);
        out.push(prefix);
      }
    }
    if (!seen.has(file)) {
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

// Tracked plus untracked-but-not-ignored files. git lists files only, so
// directory candidates are derived synthetically.
async function enumerateWithGit(io: FileIndexDeps, root: string): Promise<EnumResult> {
  const result = await runProcess(io, "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  if (!result.ok) return { ok: false };
  const files = result.out.toString("utf8").split("\0").filter((p) => p.length > 0);
  return { ok: true, enumerator: "git", entries: withSyntheticDirs(files) };
}

// fd's defaults already skip .git and respect .gitignore; a missing fd is
// a spawn failure at probe time and simply advances the chain. fd's plain
// listing cannot mark directories, so entries are stored verbatim.
async function enumerateWithFd(io: FileIndexDeps, root: string): Promise<EnumResult> {
  const result = await runProcess(io, "fd", ["--type", "f", "--type", "d"], root);
  if (!result.ok) return { ok: false };
  const entries = result.out.toString("utf8").split("\n").filter((p) => p.length > 0);
  return { ok: true, enumerator: "fd", entries };
}

// Depth-first walk; per directory the listing is sorted so the order is
// deterministic across machines. Directories more than MAX_DEPTH levels
// below the root are not entered; SKIP_DIRS names are never entered;
// symlinks are ignored (they are neither file nor directory entries).
async function enumerateWithWalk(root: string): Promise<EnumResult> {
  try {
    const out: string[] = [];
    await walkDir(root, "", 0, out);
    return { ok: true, enumerator: "walk", entries: out };
  } catch {
    return { ok: false };
  }
}

async function walkDir(absDir: string, relPrefix: string, depth: number, out: string[]): Promise<void> {
  const dirents = await readdir(absDir, { withFileTypes: true });
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name) || depth + 1 > MAX_DEPTH) continue;
      const rel = relPrefix + dirent.name + "/";
      out.push(rel);
      await walkDir(join(absDir, dirent.name), rel, depth + 1, out);
    } else if (dirent.isFile()) {
      out.push(relPrefix + dirent.name);
    }
  }
}

// First success along the chain wins. A memoized kind shortens the chain
// to that single enumerator so a refresh skips re-probing.
async function enumerate(io: FileIndexDeps, root: string, memoized: EnumeratorKind | null): Promise<EnumResult> {
  const chain: EnumeratorKind[] = memoized !== null ? [memoized] : ["git", "fd", "walk"];
  for (const kind of chain) {
    const result =
      kind === "git"
        ? await enumerateWithGit(io, root)
        : kind === "fd"
          ? await enumerateWithFd(io, root)
          : await enumerateWithWalk(root);
    if (result.ok) return result;
  }
  return { ok: false };
}

export function createFileIndex(deps: Partial<FileIndexDeps> = {}): FileIndex {
  const io: FileIndexDeps = { spawn: deps.spawn ?? nodeSpawn, now: deps.now ?? Date.now };
  let slot: FileIndexSlot | null = null;
  const building = new Set<FileIndexSlot>();

  // Applies a finished build to its target slot. When the queried root has
  // changed meanwhile, the slot was replaced wholesale and the stale build
  // is discarded instead of clobbering the new root's slot.
  function applyResult(target: FileIndexSlot, result: EnumResult): void {
    if (slot !== target) return;
    target.at = io.now();
    if (!result.ok) {
      target.state = "failed";
      target.entries = [];
      target.enumerator = null;
    } else if (result.entries.length > MAX_ENTRIES) {
      target.state = "oversized";
      target.entries = [];
      target.enumerator = result.enumerator;
    } else {
      target.state = "ready";
      target.entries = result.entries;
      target.enumerator = result.enumerator;
    }
  }

  // Fire-and-forget build; the async body catches everything, so no path
  // can produce an unhandled rejection.
  function startBuild(target: FileIndexSlot): void {
    building.add(target);
    void (async () => {
      try {
        applyResult(target, await enumerate(io, target.root, target.enumerator));
      } catch {
        applyResult(target, { ok: false });
      } finally {
        building.delete(target);
      }
    })();
  }

  function query(root: string): IndexSnapshot {
    if (slot === null || slot.root !== root) {
      const fresh: FileIndexSlot = { root, state: "building", entries: [], enumerator: null, at: io.now() };
      slot = fresh;
      startBuild(fresh);
      return { state: fresh.state, entries: fresh.entries };
    }
    // Stale-while-revalidate: serve the stale snapshot and start exactly
    // one refresh; the state stays "ready"/"oversized"/"failed" until the
    // refresh completes.
    if (!building.has(slot) && io.now() - slot.at > STALE_MS) startBuild(slot);
    return { state: slot.state, entries: slot.entries };
  }

  return { query };
}
