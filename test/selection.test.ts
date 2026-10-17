import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalize,
  clampPosition,
  type Position,
  type Selection,
} from "../src/selection.ts";

const lines = ["alpha", "beta", "gamma"];

function sel(anchor: Position, cursor: Position, mode: Selection["mode"] = "char"): Selection {
  return { anchor, cursor, mode };
}

test("normalize: forward char-wise keeps columns", () => {
  const range = normalize(sel({ line: 0, col: 1 }, { line: 2, col: 3 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 1, endLine: 2, endCol: 3 });
});

test("normalize: backward char-wise swaps to the forward range", () => {
  const range = normalize(sel({ line: 2, col: 3 }, { line: 0, col: 1 }, "char"), lines);
  assert.deepEqual(range, { startLine: 0, startCol: 1, endLine: 2, endCol: 3 });
});

test("normalize: same-line backward char-wise keeps columns", () => {
  const range = normalize(sel({ line: 1, col: 3 }, { line: 1, col: 1 }, "char"), lines);
  assert.deepEqual(range, { startLine: 1, startCol: 1, endLine: 1, endCol: 3 });
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

test("normalize: degenerate selection (anchor equals cursor) stays empty", () => {
  const range = normalize(sel({ line: 1, col: 2 }, { line: 1, col: 2 }, "char"), lines);
  assert.deepEqual(range, { startLine: 1, startCol: 2, endLine: 1, endCol: 2 });
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
