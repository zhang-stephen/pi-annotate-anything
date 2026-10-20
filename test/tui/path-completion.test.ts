import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completePath, fuzzyAvailable } from "../../src/tui/path-completion.ts";
import type { FileIndex, IndexState } from "../../src/core/file-index.ts";

// One fixture root per test file. The symlink fixture is deliberately NOT
// created here: it lives inside the symlink test only, so the exact-list
// assertions in earlier tests cannot be affected by it (and so that test
// can be skipped on platforms where symlink creation is not permitted).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-annotate-pc-"));
process.on("exit", () => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

fs.writeFileSync(path.join(tmp, "alpha.ts"), "");
fs.writeFileSync(path.join(tmp, "alpine.ts"), "");
fs.writeFileSync(path.join(tmp, "beta.ts"), "");
fs.writeFileSync(path.join(tmp, ".hidden"), "");
fs.mkdirSync(path.join(tmp, "sub"));
fs.writeFileSync(path.join(tmp, "sub", "inner.ts"), "");
fs.mkdirSync(path.join(tmp, "zeta"));
// Fuzzy-specific fixtures. rank/ proves fuzzy score ordering flips the
// alphabetical order: fuzzyMatch("bc", "zz-bc.md") (word-boundary b after
// "-") scores better than fuzzyMatch("bc", "bxc.md") (gap penalty).
fs.mkdirSync(path.join(tmp, "cap"));
fs.mkdirSync(path.join(tmp, "dot"));
fs.writeFileSync(path.join(tmp, "dot", ".rc"), "");
fs.writeFileSync(path.join(tmp, "dot", ".readme"), "");
fs.writeFileSync(path.join(tmp, "dot", "rc2"), "");
fs.mkdirSync(path.join(tmp, "rank"));
fs.writeFileSync(path.join(tmp, "rank", "bxc.md"), "");
fs.writeFileSync(path.join(tmp, "rank", "zz-bc.md"), "");
fs.writeFileSync(path.join(tmp, "rank", "qq.md"), "");
fs.mkdirSync(path.join(tmp, "rank", "bcd"));

// Stub FileIndex serving a canned snapshot; counts query() calls so tests
// can pin the warm-up contract (every completion call consults the index).
function stubIndex(state: IndexState, entries: string[]) {
  const calls = { queries: 0 };
  const index: FileIndex = {
    query() {
      calls.queries++;
      return { state, entries: entries.slice() };
    },
  };
  return { index, calls };
}

// Shared stub for rules 1 and 2, which must never consume index entries.
const noIndex = stubIndex("ready", []).index;

test("fuzzyAvailable is a real boolean exported from the link-safe probe", () => {
  assert.strictEqual(typeof fuzzyAvailable, "boolean");
  assert.ok(fuzzyAvailable, "the dev-time pi-tui must export the fuzzy helpers");
});

// Rule 1: empty query, unchanged cwd browsing.
test("empty query lists cwd entries (dirs first, alphabetical), ignoring the index", () => {
  const items = completePath("", tmp, stubIndex("ready", ["zzz-from-index.ts"]).index)!;
  assert.deepStrictEqual(items.map(i => i.label), [
    "cap/",
    "dot/",
    "rank/",
    "sub/",
    "zeta/",
    "alpha.ts",
    "alpine.ts",
    "beta.ts",
  ]);
  assert.strictEqual(items[0].description, "dir");
  assert.strictEqual(items.find(i => i.label === "alpha.ts")!.description, undefined);
});

test("every completion call warms the index exactly once", () => {
  const warm = stubIndex("building", []);
  completePath("", tmp, warm.index);
  assert.strictEqual(warm.calls.queries, 1);
  completePath("sub/", tmp, warm.index);
  assert.strictEqual(warm.calls.queries, 2);
});

// Rule 2: slash query, fuzzy within the fixed directory part.
test("slash query fuzzy-matches within the fixed directory; dirs before files, each group by fuzzy score", () => {
  const items = completePath("rank/bc", tmp, noIndex)!;
  assert.deepStrictEqual(items.map(i => i.value), ["rank/bcd/", "rank/zz-bc.md", "rank/bxc.md"]);
  assert.strictEqual(items[0].description, "dir");
  assert.ok(!items.some(i => i.label === "qq.md"), "non-matching entries are excluded");
});

test("slash query with empty base keeps the legacy alphabetical listing", () => {
  const items = completePath("rank/", tmp, noIndex)!;
  assert.deepStrictEqual(items.map(i => i.label), ["bcd/", "bxc.md", "qq.md", "zz-bc.md"]);
});

test("dotfiles hidden in directory listings unless the query starts with a dot", () => {
  assert.deepStrictEqual(completePath("dot/r", tmp, noIndex)!.map(i => i.label), ["rc2"]);
  assert.deepStrictEqual(completePath("dot/.re", tmp, noIndex)!.map(i => i.label), [".readme"]);
});

// Rule 3: no-slash non-empty query, fuzzy over the workspace index.
test("non-slash query fuzzy-matches workspace index entries in enumeration order on equal scores", () => {
  const idx = stubIndex("ready", [
    "src/core/file-index.ts",
    "src/core/file-range.ts",
    "src/tui/",
    "src/tui/editor.ts",
    "readme.md",
  ]);
  assert.deepStrictEqual(completePath("fi", tmp, idx.index)!.map(i => i.value), [
    "src/core/file-index.ts",
    "src/core/file-range.ts",
  ]);
});

test("index directories are offered as /-suffixed candidates with the dir description", () => {
  const idx = stubIndex("ready", ["src/tui/", "src/tui/editor.ts"]);
  const items = completePath("tui", tmp, idx.index)!;
  assert.deepStrictEqual(items.map(i => i.value), ["src/tui/", "src/tui/editor.ts"]);
  assert.strictEqual(items[0].description, "dir");
  assert.strictEqual(items[0].label, "src/tui/");
  assert.strictEqual(items[1].description, undefined);
});

test("index dotfile entries stay hidden unless the query starts with a dot", () => {
  const idx = stubIndex("ready", ["app.ts", ".config/", "src/.hidden.ts"]);
  // "con" and "hid" fuzzy-match the dot entries, but they stay hidden.
  assert.deepStrictEqual(completePath("con", tmp, idx.index)!.map(i => i.value), []);
  assert.deepStrictEqual(completePath("hid", tmp, idx.index)!.map(i => i.value), []);
  assert.deepStrictEqual(completePath(".con", tmp, idx.index)!.map(i => i.value), [".config/"]);
  assert.deepStrictEqual(completePath(".hid", tmp, idx.index)!.map(i => i.value), ["src/.hidden.ts"]);
  assert.deepStrictEqual(completePath("app", tmp, idx.index)!.map(i => i.value), ["app.ts"]);
});

test("caps rule 3 results at 100 entries", () => {
  const entries = Array.from({ length: 150 }, (_, i) => `d/f${String(i).padStart(3, "0")}.ts`);
  const idx = stubIndex("ready", entries);
  assert.strictEqual(completePath("f", tmp, idx.index)!.length, 100);
});

test("fuzzy matching is case-insensitive (index rule)", () => {
  const idx = stubIndex("ready", ["alpha.ts"]);
  assert.deepStrictEqual(completePath("AL", tmp, idx.index)!.map(i => i.value), ["alpha.ts"]);
});

test("bare tilde matches nothing in a ready index", () => {
  const idx = stubIndex("ready", ["alpha.ts"]);
  assert.deepStrictEqual(completePath("~", tmp, idx.index), []);
});

test("building/oversized/failed index states fall back to empty-query browsing", () => {
  const expected = completePath("", tmp, noIndex)!.map(i => i.value);
  for (const state of ["building", "oversized", "failed"] as const) {
    const idx = stubIndex(state, ["junk-entry"]);
    const actual = completePath("warmupq", tmp, idx.index)!.map(i => i.value);
    assert.deepStrictEqual(actual, expected, `state ${state} must serve browsing results`);
  }
});

test("equal fuzzy scores keep enumeration order", () => {
  const idx = stubIndex("ready", ["x/abc.ts", "y/abc.ts"]);
  assert.deepStrictEqual(completePath("abc", tmp, idx.index)!.map(i => i.value), ["x/abc.ts", "y/abc.ts"]);
});

test("tilde-slash prefix expands home; values keep the ~/ prefix", () => {
  const home = completePath("~/", tmp, noIndex);
  assert.ok(Array.isArray(home));
  assert.ok(home!.every(i => i.value.startsWith("~/")));
});

test("absolute prefix resolves and keeps the absolute directory part in values", () => {
  const items = completePath(path.join(tmp, "sub") + "/", tmp, noIndex)!;
  assert.deepStrictEqual(items.map(i => i.value), [path.join(tmp, "sub") + "/inner.ts"]);
});

test("missing directory returns null", () => {
  assert.strictEqual(completePath("no-such-dir-anywhere/", tmp, noIndex), null);
});

test("symlink to a directory is offered by Dirent type, without trailing slash", (t) => {
  let created = false;
  try {
    fs.symlinkSync("sub", path.join(tmp, "linkdir"), "dir");
    created = true;
  } catch {
    // Platform denies symlink creation (e.g. Windows without privileges).
  }
  if (!created) return t.skip("symlink creation not permitted on this platform");
  const items = completePath(tmp + "/", tmp, noIndex)!;
  const link = items.find(i => i.value === tmp + "/linkdir");
  assert.ok(link, "symlink entry missing from the listing");
  assert.strictEqual(link!.description, undefined);
});

// Mutates the fixture root (105 files under cap/): runs last by declaration
// order; the files live inside cap/, so no root-listing assertion above can
// be affected.
test("caps rule 2 results at 100 entries", () => {
  for (let i = 0; i < 105; i++) fs.writeFileSync(path.join(tmp, "cap", `f${String(i).padStart(3, "0")}`), "");
  assert.strictEqual(completePath("cap/f", tmp, noIndex)!.length, 100);
});
