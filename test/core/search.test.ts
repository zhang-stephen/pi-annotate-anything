import { test } from "node:test";
import assert from "node:assert/strict";

import { compilePattern, findMatches, jumpTarget } from "../../src/core/search.ts";
import type { LineMatch } from "../../src/core/search.ts";

const M: LineMatch[] = [
  { line: 1, startCol: 0, endCol: 3 },
  { line: 3, startCol: 2, endCol: 5 },
  { line: 5, startCol: 1, endCol: 2 },
];

test("compilePattern: smartcase flags", () => {
  const lower = compilePattern("foo");
  assert.ok(lower.ok);
  assert.equal(lower.re.flags, "gi");
  const upper = compilePattern("Foo");
  assert.ok(upper.ok);
  assert.equal(upper.re.flags, "g");
});

test("compilePattern: invalid pattern returns the engine message, never throws", () => {
  const bad = compilePattern("(");
  assert.ok(!bad.ok);
  assert.ok(typeof bad.error === "string" && bad.error.length > 0);
});

test("findMatches: multiple matches per line, raw columns", () => {
  assert.deepEqual(findMatches(["foo bar foo"], /foo/g), [
    { line: 0, startCol: 0, endCol: 3 },
    { line: 0, startCol: 8, endCol: 11 },
  ]);
});

test("findMatches: lastIndex resets per line", () => {
  assert.deepEqual(findMatches(["foo", "foo"], /foo/g), [
    { line: 0, startCol: 0, endCol: 3 },
    { line: 1, startCol: 0, endCol: 3 },
  ]);
});

test("findMatches: zero-width matches advance and terminate", () => {
  assert.deepEqual(findMatches(["bbb"], /a*/g), [
    { line: 0, startCol: 0, endCol: 0 },
    { line: 0, startCol: 1, endCol: 1 },
    { line: 0, startCol: 2, endCol: 2 },
    { line: 0, startCol: 3, endCol: 3 },
  ]);
});

test("findMatches: raw columns on tabbed and CJK lines", () => {
  assert.deepEqual(findMatches(["\tfoo"], /foo/g), [{ line: 0, startCol: 1, endCol: 4 }]);
  assert.deepEqual(findMatches(["中中x"], /x/g), [{ line: 0, startCol: 2, endCol: 3 }]);
});

test("jumpTarget: forward with counts and wrap flag", () => {
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 2), { pos: { line: 5, col: 1 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 3), { pos: { line: 1, col: 0 }, wrapped: true });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 4), { pos: { line: 3, col: 2 }, wrapped: true });
});

test("jumpTarget: strictly after the from position", () => {
  assert.deepEqual(jumpTarget(M, { line: 1, col: 1 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 2, col: 0 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
});

test("jumpTarget: backward with wrap flag", () => {
  assert.deepEqual(jumpTarget(M, { line: 3, col: 2 }, -1, 1), { pos: { line: 1, col: 0 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, -1, 1), { pos: { line: 5, col: 1 }, wrapped: true });
});

test("jumpTarget: empty matches return null; zero-width matches are jumpable", () => {
  assert.equal(jumpTarget([], { line: 0, col: 0 }, 1, 1), null);
  const zw: LineMatch[] = [{ line: 0, startCol: 1, endCol: 1 }];
  assert.deepEqual(jumpTarget(zw, { line: 0, col: 0 }, 1, 1), { pos: { line: 0, col: 1 }, wrapped: false });
});
