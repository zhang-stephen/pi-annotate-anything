// Tests for the async workspace file index. External effects are stubbed or
// injected: child processes come from a fake spawn whose outcomes the test
// delivers explicitly, and the clock is injected, so the enumeration chain
// order, memoization, single-build guard, the 20,000 entry cap, stale-while-
// revalidate, and the failed state are pinned without touching the real
// process tree. The walk-fallback tests use real mkdtemp fixture trees
// because the walk reads the filesystem directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileIndex,
  NON_INDEXABLE_DIRS,
  type FileIndexDeps,
} from "../../src/core/file-index.ts";

const GIT_ARGS = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
const FD_BASE_ARGS = ["--type", "f", "--type", "d"];
// Without a root .gitignore the shared non-indexable list is passed as -E
// excludes; with one, fd follows it via --no-require-git instead.
const FD_EXCLUDE_ARGS = [...FD_BASE_ARGS, ...NON_INDEXABLE_DIRS.flatMap((d) => ["-E", d])];

// Pin the list contents literally: every other consumer derives from the
// constant, so an accidental edit (e.g. adding vendor) would otherwise stay
// green while violating the spec's deliberate non-exclusion.
test("NON_INDEXABLE_DIRS matches the spec's shared list exactly", () => {
  assert.deepEqual([...NON_INDEXABLE_DIRS], [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
  ]);
});
const FD_FOLLOW_GITIGNORE_ARGS = [...FD_BASE_ARGS, "--no-require-git"];

// The parent passes stdio ["ignore", "pipe", "ignore"] so a chatty child's
// stderr pipe can never fill and block it (nothing would drain it).
const SPAWN_STDIO = ["ignore", "pipe", "ignore"];

type SpawnOutcome = { code: number; out?: string } | { error: Error };

// Fake spawn: records every call and returns inert child processes whose
// error/close events fire only when the test delivers an outcome.
function spawnStub() {
  const calls: { cmd: string; args: string[]; cwd: string | undefined }[] = [];
  const opts: { stdio?: unknown }[] = [];
  const children: {
    cmd: string;
    data: ((chunk: Buffer) => void) | null;
    listeners: Map<string, (arg?: unknown) => void>;
  }[] = [];

  const spawn = ((cmd: string, args: string[], spawnOpts?: { cwd?: string; stdio?: unknown }) => {
    const rec = {
      cmd,
      data: null as ((chunk: Buffer) => void) | null,
      listeners: new Map<string, (arg?: unknown) => void>(),
    };
    children.push(rec);
    calls.push({ cmd, args, cwd: spawnOpts?.cwd });
    opts.push({ stdio: spawnOpts?.stdio });
    return {
      on(event: string, cb: (arg?: unknown) => void) {
        rec.listeners.set(event, cb);
      },
      stdout: {
        on(_event: string, cb: (chunk: Buffer) => void) {
          rec.data = cb;
        },
      },
    } as unknown as ChildProcess;
  }) as unknown as FileIndexDeps["spawn"];

  return {
    spawn,
    calls,
    opts,
    deliver(cmd: string, nth: number, outcome: SpawnOutcome) {
      const rec = children.filter((c) => c.cmd === cmd)[nth];
      assert.ok(rec, `no spawned ${cmd} #${nth}`);
      if ("error" in outcome) {
        rec.listeners.get("error")?.(outcome.error);
        return;
      }
      if (outcome.out) rec.data?.(Buffer.from(outcome.out, "utf8"));
      rec.listeners.get("close")?.(outcome.code);
    },
  };
}

function enoent(cmd: string): Error {
  return Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
}

function clockAt(start = 0) {
  const t = { now: start };
  return { value: t, now: () => t.now };
}

// Drains the build's promise chain so a delivered outcome becomes visible
// in the slot before the next observation.
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

// The walk reads the real filesystem, so its completion is polled for.
async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

function gitOut(paths: string[]): string {
  return paths.join("\0") + "\0";
}

// Fixture tree for walk tests. Layout (children sort in this order per
// directory): every directory in NON_INDEXABLE_DIRS exists with an inner
// file that would leak into the entries if the walk entered it; .hidden and
// a.txt are emitted, deep/ chains nine levels so d9 sits beyond the depth
// cap, src/b.ts covers nested files.
async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "file-index-"));
  for (const dir of NON_INDEXABLE_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "inner.txt"), "x");
  }
  await writeFile(join(root, ".hidden"), "h");
  await writeFile(join(root, "a.txt"), "a");
  let deep = join(root, "deep");
  await mkdir(deep);
  for (let i = 1; i <= 9; i++) {
    deep = join(deep, `d${i}`);
    await mkdir(deep);
  }
  await writeFile(join(deep, "leaf.txt"), "leaf"); // inside d9: beyond the cap
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "b.ts"), "b");
  return root;
}

test("query: cold root returns building with empty entries and probes git first", () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  const snapshot = index.query("/ws");
  assert.deepEqual(snapshot, { state: "building", entries: [] });
  assert.deepEqual(stub.calls, [{ cmd: "git", args: GIT_ARGS, cwd: "/ws" }]);
});

test("query: exactly one build in flight while the first build runs", () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  index.query("/ws");
  const snapshot = index.query("/ws");
  assert.equal(stub.calls.length, 1);
  assert.equal(snapshot.state, "building");
});

test("chain: git success wins, keeps enumeration order, never probes fd/walk", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  stub.deliver("git", 0, { code: 0, out: gitOut(["src/b.ts", "a.ts", "src/core/x.ts"]) });
  await settle();
  assert.deepEqual(stub.calls.map((c) => c.cmd), ["git"]);
  assert.deepEqual(index.query("/ws"), {
    state: "ready",
    entries: ["src/", "src/b.ts", "a.ts", "src/core/", "src/core/x.ts"],
  });
});

test("chain: git failure advances the probe to fd, which gets -E excludes without a root .gitignore", async () => {
  const root = await mkdtemp(join(tmpdir(), "file-index-"));
  try {
    const stub = spawnStub();
    const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
    index.query(root);
    stub.deliver("git", 0, { error: enoent("git") });
    await until(() => stub.calls.length >= 2, "fd probe");
    assert.equal(index.query(root).state, "building");
    assert.deepEqual(stub.calls.map((c) => c.cmd), ["git", "fd"]);
    assert.deepEqual(stub.calls[1].args, FD_EXCLUDE_ARGS);
    stub.deliver("fd", 0, { code: 0, out: "a.ts\nsrc" });
    await until(() => index.query(root).state !== "building", "fd completion");
    // fd entries are stored verbatim (its plain listing cannot mark dirs).
    assert.deepEqual(index.query(root), { state: "ready", entries: ["a.ts", "src"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chain: with a root .gitignore fd follows it via --no-require-git instead of -E excludes", async () => {
  const root = await mkdtemp(join(tmpdir(), "file-index-"));
  try {
    await writeFile(join(root, ".gitignore"), "node_modules\n");
    const stub = spawnStub();
    const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
    index.query(root);
    stub.deliver("git", 0, { error: enoent("git") });
    await until(() => stub.calls.length >= 2, "fd probe");
    assert.deepEqual(stub.calls.map((c) => c.cmd), ["git", "fd"]);
    assert.deepEqual(stub.calls[1].args, FD_FOLLOW_GITIGNORE_ARGS);
    stub.deliver("fd", 0, { code: 0, out: "kept.ts" });
    await until(() => index.query(root).state !== "building", "fd completion");
    assert.deepEqual(index.query(root), { state: "ready", entries: ["kept.ts"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chain: git non-zero exit advances the probe to fd", async () => {
  const root = await mkdtemp(join(tmpdir(), "file-index-"));
  try {
    const stub = spawnStub();
    const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
    index.query(root);
    stub.deliver("git", 0, { code: 128 }); // e.g. not a git repository
    await until(() => stub.calls.length >= 2, "fd probe");
    assert.deepEqual(stub.calls.map((c) => c.cmd), ["git", "fd"]);
    assert.deepEqual(stub.calls[1].args, FD_EXCLUDE_ARGS);
    // Children are spawned with stderr ignored: nothing drains it, so a
    // piped stderr could fill its OS buffer and hang the child.
    assert.deepEqual(stub.opts[0], { stdio: SPAWN_STDIO });
    stub.deliver("fd", 0, { code: 0, out: "recovered.ts" });
    await until(() => index.query(root).state !== "building", "fd completion");
    assert.deepEqual(index.query(root), { state: "ready", entries: ["recovered.ts"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chain: git and fd failures fall back to the bounded walk", async () => {
  const root = await makeFixture();
  try {
    const stub = spawnStub();
    const clock = clockAt(1000);
    const index = createFileIndex({ spawn: stub.spawn, now: clock.now });
    assert.equal(index.query(root).state, "building");
    stub.deliver("git", 0, { error: enoent("git") });
    // The fd probe involves a real .gitignore stat before the spawn, so
    // poll for the spawn instead of ticking a fixed number of turns.
    await until(() => stub.calls.length >= 2, "fd probe");
    stub.deliver("fd", 0, { error: enoent("fd") });
    await until(() => index.query(root).state !== "building", "walk completion");
    // deep/ chains nine nested levels; only directories up to eight levels
    // below the root are entered, so d8/d9 and d9's leaf.txt are excluded.
    assert.deepEqual(index.query(root).entries, [
      ".hidden",
      "a.txt",
      "deep/",
      "deep/d1/",
      "deep/d1/d2/",
      "deep/d1/d2/d3/",
      "deep/d1/d2/d3/d4/",
      "deep/d1/d2/d3/d4/d5/",
      "deep/d1/d2/d3/d4/d5/d6/",
      "deep/d1/d2/d3/d4/d5/d6/d7/",
      "src/",
      "src/b.ts",
    ]);
    // Every shared skip dir exists in the fixture with an inner file; none
    // of them may appear (as a dir entry or through their contents).
    const entries = index.query(root).entries;
    for (const dir of NON_INDEXABLE_DIRS) {
      assert.ok(
        !entries.some((e) => e === dir || e.startsWith(dir + "/")),
        `${dir} must be skipped by the walk`,
      );
    }
    // Memoized walk: a stale refresh re-walks but never re-probes git/fd.
    clock.value.now += 5001;
    index.query(root);
    assert.equal(stub.calls.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("swr: past TTL the stale entries are served while exactly one refresh runs", async () => {
  const stub = spawnStub();
  const clock = clockAt(1000);
  const index = createFileIndex({ spawn: stub.spawn, now: clock.now });
  index.query("/ws");
  stub.deliver("git", 0, { code: 0, out: gitOut(["old.ts"]) });
  await settle();
  clock.value.now += 5001; // stale
  const stale = index.query("/ws");
  assert.deepEqual(stale, { state: "ready", entries: ["old.ts"] });
  assert.deepEqual(stub.calls.map((c) => c.cmd), ["git", "git"]); // no fd re-probe
  index.query("/ws");
  index.query("/ws");
  assert.equal(stub.calls.length, 2, "refresh must stay single while in flight");
  stub.deliver("git", 1, { code: 0, out: gitOut(["new.ts"]) });
  await settle();
  assert.deepEqual(index.query("/ws"), { state: "ready", entries: ["new.ts"] });
});

test("fresh: within TTL a ready entry is served without any new spawn", async () => {
  const stub = spawnStub();
  const clock = clockAt(1000);
  const index = createFileIndex({ spawn: stub.spawn, now: clock.now });
  index.query("/ws");
  stub.deliver("git", 0, { code: 0, out: gitOut(["a.ts"]) });
  await settle();
  clock.value.now += 4000;
  assert.deepEqual(index.query("/ws"), { state: "ready", entries: ["a.ts"] });
  assert.equal(index.query("/ws").state, "ready");
  assert.equal(stub.calls.length, 1);
});

test("cap: more than 20,000 entries becomes oversized with empty entries", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  stub.deliver("git", 0, {
    code: 0,
    out: gitOut(Array.from({ length: 20001 }, (_, i) => `f${i}.txt`)),
  });
  await settle();
  assert.deepEqual(index.query("/ws"), { state: "oversized", entries: [] });
});

test("cap: exactly 20,000 entries stays ready and keeps enumeration order", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  stub.deliver("git", 0, {
    code: 0,
    out: gitOut(Array.from({ length: 20000 }, (_, i) => `f${i}.txt`)),
  });
  await settle();
  const snapshot = index.query("/ws");
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.entries.length, 20000);
  assert.equal(snapshot.entries[0], "f0.txt");
  assert.equal(snapshot.entries[19999], "f19999.txt");
});

test("query: returned entries are a defensive copy; callers may sort or mutate freely", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  stub.deliver("git", 0, { code: 0, out: gitOut(["a.ts", "b.ts"]) });
  await settle();
  const snapshot = index.query("/ws");
  snapshot.entries.reverse();
  snapshot.entries.push("mutated.ts");
  assert.deepEqual(index.query("/ws").entries, ["a.ts", "b.ts"]);
});

test("failed: every enumerator failing lands failed without unhandled rejection", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/does-not-exist");
  stub.deliver("git", 0, { error: enoent("git") });
  // The fd probe involves a real .gitignore stat before the spawn, so poll
  // for the spawn instead of ticking a fixed number of turns.
  await until(() => stub.calls.length >= 2, "fd probe");
  stub.deliver("fd", 0, { error: enoent("fd") });
  await until(() => index.query("/does-not-exist").state !== "building", "walk failure");
  assert.deepEqual(index.query("/does-not-exist"), { state: "failed", entries: [] });
});

test("refresh: memoized winner failing on refresh lands failed", async () => {
  const stub = spawnStub();
  const clock = clockAt(1000);
  const index = createFileIndex({ spawn: stub.spawn, now: clock.now });
  index.query("/ws");
  stub.deliver("git", 0, { code: 0, out: gitOut(["old.ts"]) });
  await settle();
  clock.value.now += 5001;
  index.query("/ws"); // starts the refresh
  stub.deliver("git", 1, { error: enoent("git") });
  await settle();
  assert.deepEqual(index.query("/ws"), { state: "failed", entries: [] });
});

test("root: switching roots replaces the slot wholesale and drops the stale build", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/a");
  assert.deepEqual(index.query("/b"), { state: "building", entries: [] });
  assert.equal(stub.calls.length, 2);
  assert.equal(stub.calls[0].cwd, "/a");
  assert.equal(stub.calls[1].cwd, "/b");
  stub.deliver("git", 1, { code: 0, out: gitOut(["b.ts"]) }); // /b finishes first
  await settle();
  assert.deepEqual(index.query("/b"), { state: "ready", entries: ["b.ts"] });
  stub.deliver("git", 0, { code: 0, out: gitOut(["a.ts"]) }); // late /a result
  await settle();
  assert.deepEqual(index.query("/b"), { state: "ready", entries: ["b.ts"] });
});
