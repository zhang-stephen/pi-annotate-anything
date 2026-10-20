import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalize,
  clampPosition,
  type Position,
  type Selection,
} from "../../src/core/selection.ts";
import { rangeLabel } from "../../src/core/message.ts";
import { extractRange } from "../../src/core/file-range.ts";

const lines = ["alpha", "beta", "gamma"];

function sel(anchor: Position, cursor: Position, mode: Selection["mode"] = "char"): Selection {
  return { anchor, cursor, mode };
}

test("normalize: forward char-wise keeps columns", () => {
  // Char mode is vim-inclusive: endCol is one past the cursor char.
  const range = normalize(sel({ line: 0, col: 1 }, { line: 2, col: 3 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 1, endLine: 2, endCol: 4 });
});

test("normalize: backward char-wise swaps to the forward range", () => {
  const range = normalize(sel({ line: 2, col: 3 }, { line: 0, col: 1 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 1, endLine: 2, endCol: 4 });
});

test("normalize: same-line backward char-wise keeps columns", () => {
  const range = normalize(sel({ line: 1, col: 3 }, { line: 1, col: 1 }, "char"), lines);
  assert.deepEqual(range, { startLine: 1, startCol: 1, endLine: 1, endCol: 4 });
});

test("normalize: line-wise expands to full lines (col 0 to line length)", () => {
  const range = normalize(sel({ line: 0, col: 2 }, { line: 2, col: 1 }, "line"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 2, endCol: lines[2].length });
});

test("normalize: backward line-wise expands to full lines", () => {
  const range = normalize(sel({ line: 2, col: 1 }, { line: 0, col: 2 }, "line"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 2, endCol: lines[2].length });
});

test("normalize: o swap of anchor and cursor yields the same range", () => {
  const forward = sel({ line: 0, col: 1 }, { line: 2, col: 3 }, "char");
  const swapped: Selection = {
    anchor: forward.cursor,
    cursor: forward.anchor,
    mode: forward.mode,
  };
  assert.deepEqual(normalize(swapped, lines), normalize(forward, lines));
});

test("normalize: degenerate char selection selects exactly the cursor character", () => {
  // vim semantics: v at col c with no movement selects the one char at c,
  // so endCol is c + 1 (still an end-exclusive slice bound).
  const range = normalize(sel({ line: 1, col: 2 }, { line: 1, col: 2 }, "char"), lines);
  assert.deepEqual(range, { startLine: 1, startCol: 2, endLine: 1, endCol: 3 });
});

test("normalize: char-wise endCol clamps at the line length ($ then v)", () => {
  // $ clamps the cursor col to the line length; endCol stays a slice bound.
  const range = normalize(sel({ line: 0, col: 0 }, { line: 0, col: 5 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
});

test("normalize: v at col 0 plus four l presses selects cols 0..4 (5 chars)", () => {
  const range = normalize(sel({ line: 0, col: 0 }, { line: 0, col: 4 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
});

test("char-wise selection: label and snapshot agree on the selected span", () => {
  const range = normalize(sel({ line: 0, col: 0 }, { line: 0, col: 4 }, "char"), lines);
  assert.equal(rangeLabel(range, "char"), "lines 1:1-1:5");
  assert.equal(extractRange(lines, range), "alpha"); // slice(0, 5)
});

test("normalize: clamps out-of-bounds cursor before computing the range", () => {
  const range = normalize(sel({ line: 0, col: 0 }, { line: 99, col: 99 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 2, endCol: lines[2].length });
});

test("normalize: empty file yields a zero range", () => {
  const range = normalize(sel({ line: 0, col: 0 }, { line: 0, col: 1 }, "line"), []);
  assert.deepEqual(range, { startLine: 0, startCol: 0, endLine: 0, endCol: 0 });
});

test("clampPosition: clamps col to the last column of its line", () => {
  assert.deepEqual(clampPosition({ line: 0, col: 99 }, lines), { line: 0, col: 5 });
});

test("clampPosition: clamps negative col to zero", () => {
  assert.deepEqual(clampPosition({ line: 1, col: -2 }, lines), { line: 1, col: 0 });
});

test("clampPosition: clamps line to file bounds, col against the landed line", () => {
  assert.deepEqual(clampPosition({ line: 10, col: 1 }, lines), { line: 2, col: 1 });
  assert.deepEqual(clampPosition({ line: 10, col: 99 }, lines), { line: 2, col: lines[2].length });
  assert.deepEqual(clampPosition({ line: -1, col: 0 }, lines), { line: 0, col: 0 });
});

test("clampPosition: empty file clamps to origin", () => {
  assert.deepEqual(clampPosition({ line: 3, col: 7 }, []), { line: 0, col: 0 });
});

test("clampPosition: empty line clamps col to zero", () => {
  assert.deepEqual(clampPosition({ line: 1, col: 5 }, ["a", "", "b"]), { line: 1, col: 0 });
});
