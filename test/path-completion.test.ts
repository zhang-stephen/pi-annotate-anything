import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completePath } from "../src/path-completion.ts";

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

test("filters entries by base prefix; files use name as value and label, no description", () => {
  const items = completePath("al", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["alpha.ts", "alpine.ts"]);
  assert.ok(items.every(i => i.description === undefined && i.label === i.value));
});

test("directories sort first and carry a trailing slash plus dir description", () => {
  const items = completePath("", tmp)!;
  assert.deepStrictEqual(items.map(i => i.label), ["sub/", "zeta/", "alpha.ts", "alpine.ts", "beta.ts"]);
  assert.strictEqual(items[0].description, "dir");
});

test("prefix ending in a directory lists its contents with prefixed values", () => {
  const items = completePath("sub/", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["sub/inner.ts"]);
});

test("dotfiles hidden unless base starts with a dot", () => {
  assert.ok(!completePath("", tmp)!.some(i => i.label === ".hidden"));
  assert.deepStrictEqual(completePath(".", tmp)!.map(i => i.label), [".hidden"]);
});

test("case-sensitive prefix matching", () => {
  assert.ok(!completePath("AL", tmp)!.length);
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
  const items = completePath("li", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["linkdir"]);
});

test("tilde-slash prefix expands home; bare tilde does not", () => {
  const home = completePath("~/", tmp);
  assert.ok(Array.isArray(home));
  assert.ok(home!.every(i => i.value.startsWith("~/")));
  assert.deepStrictEqual(completePath("~", tmp), []);
});

test("absolute prefix resolves and keeps the absolute directory part in values", () => {
  const items = completePath(path.join(tmp, "sub") + "/", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), [path.join(tmp, "sub") + "/inner.ts"]);
});

test("missing directory returns null", () => {
  assert.strictEqual(completePath("no-such-dir-anywhere/", tmp), null);
});

// Mutates the fixture root (105 f* files): runs last by declaration order;
// no exact-list assertion may be added after this test.
test("caps results at 100 entries", () => {
  for (let i = 0; i < 105; i++) fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, "0")}`), "");
  assert.strictEqual(completePath("f", tmp)!.length, 100);
});
