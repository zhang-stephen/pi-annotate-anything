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

import { createFileIndex, type FileIndexDeps } from "../../src/core/file-index.ts";

const GIT_ARGS = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
const FD_ARGS = ["--type", "f", "--type", "d"];

type SpawnOutcome = { code: number; out?: string } | { error: Error };

// Fake spawn: records every call and returns inert child processes whose
// error/close events fire only when the test delivers an outcome.
function spawnStub() {
  const calls: { cmd: string; args: string[]; cwd: string | undefined }[] = [];
  const children: {
    cmd: string;
    data: ((chunk: Buffer) => void) | null;
    listeners: Map<string, (arg?: unknown) => void>;
  }[] = [];

  const spawn = ((cmd: string, args: string[], opts?: { cwd?: string }) => {
    const rec = {
      cmd,
      data: null as ((chunk: Buffer) => void) | null,
      listeners: new Map<string, (arg?: unknown) => void>(),
    };
    children.push(rec);
    calls.push({ cmd, args, cwd: opts?.cwd });
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
// directory): .git/INNER and node_modules/x/y.js and dist/z.js are skipped,
// .hidden and a.txt are emitted, deep/ chains nine levels so d9 sits beyond
// the depth cap, src/b.ts covers nested files.
async function makeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "file-index-"));
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, ".git", "INNER"), "g");
  await writeFile(join(root, ".hidden"), "h");
  await writeFile(join(root, "a.txt"), "a");
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "node_modules", "x", "y.js"), "y");
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "z.js"), "z");
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

test("chain: git failure advances the probe to fd", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/ws");
  stub.deliver("git", 0, { error: enoent("git") });
  await settle();
  assert.equal(index.query("/ws").state, "building");
  assert.deepEqual(stub.calls.map((c) => c.cmd), ["git", "fd"]);
  assert.deepEqual(stub.calls[1].args, FD_ARGS);
  stub.deliver("fd", 0, { code: 0, out: "a.ts\nsrc" });
  await settle();
  // fd entries are stored verbatim (its plain listing cannot mark dirs).
  assert.deepEqual(index.query("/ws"), { state: "ready", entries: ["a.ts", "src"] });
});

test("chain: git and fd failures fall back to the bounded walk", async () => {
  const root = await makeFixture();
  try {
    const stub = spawnStub();
    const clock = clockAt(1000);
    const index = createFileIndex({ spawn: stub.spawn, now: clock.now });
    assert.equal(index.query(root).state, "building");
    stub.deliver("git", 0, { error: enoent("git") });
    await settle();
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

test("failed: every enumerator failing lands failed without unhandled rejection", async () => {
  const stub = spawnStub();
  const index = createFileIndex({ spawn: stub.spawn, now: clockAt(1000).now });
  index.query("/does-not-exist");
  stub.deliver("git", 0, { error: enoent("git") });
  await settle();
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
