import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";

import { cursorCellAt, reduceComment, wrapCommentLines } from "../../src/tui/comment-input.ts";
import type { CommentState } from "../../src/tui/comment-input.ts";

// ANSI inverse-video wrapper, same shape the plan uses for width-preservation
// checks (marker wrappers like "<s>" would change the visible width).
const style = (s: string) => `\x1b[7m${s}\x1b[27m`;
const visibleWidth = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

// Shorthand: caret at end-of-text, the state every pre-caret construction
// site starts from (append-equivalence with the old caret-less reducer).
const end = (text: string): CommentState => ({ text, caret: text.length });

test("reduceComment: char appends to text", () => {
  const result = reduceComment(end("ab"), { kind: "char", ch: "c" });
  assert.deepEqual(result, { state: { text: "abc", caret: 3 } });
});

test("reduceComment: newline inserts a newline", () => {
  const result = reduceComment(end("ab"), { kind: "newline" });
  assert.deepEqual(result, { state: { text: "ab\n", caret: 3 } });
});

test("reduceComment: backspace deletes the last char", () => {
  const result = reduceComment(end("abc"), { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "ab", caret: 2 } });
});

test("reduceComment: backspace deletes a trailing newline", () => {
  const result = reduceComment(end("a\n"), { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "a", caret: 1 } });
});

test("reduceComment: backspace on empty text keeps state", () => {
  const result = reduceComment(end(""), { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "", caret: 0 } });
});

test("reduceComment: submit emits the current text", () => {
  const result = reduceComment(end("hi"), { kind: "submit" });
  assert.deepEqual(result, {
    state: { text: "hi", caret: 2 },
    effect: { type: "submit", text: "hi" },
  });
});

test("reduceComment: submit with empty text is allowed", () => {
  const result = reduceComment(end(""), { kind: "submit" });
  assert.deepEqual(result, {
    state: { text: "", caret: 0 },
    effect: { type: "submit", text: "" },
  });
});

test("reduceComment: cancel emits a cancel effect", () => {
  const result = reduceComment(end("hi"), { kind: "cancel" });
  assert.deepEqual(result, {
    state: { text: "hi", caret: 2 },
    effect: { type: "cancel" },
  });
});

test("reduceComment: does not mutate the input state", () => {
  const state: CommentState = { text: "keep", caret: 4 };
  reduceComment(state, { kind: "char", ch: "x" });
  reduceComment(state, { kind: "backspace" });
  reduceComment(state, { kind: "submit" });
  assert.deepEqual(state, { text: "keep", caret: 4 });
});

// Insert and delete at the caret ------------------------------------------------

test("reduceComment: char inserts at the caret", () => {
  const result = reduceComment({ text: "ac", caret: 1 }, { kind: "char", ch: "b" });
  assert.deepEqual(result, { state: { text: "abc", caret: 2 } });
});

test("reduceComment: newline inserts at the caret", () => {
  const result = reduceComment({ text: "ab", caret: 1 }, { kind: "newline" });
  assert.deepEqual(result, { state: { text: "a\nb", caret: 2 } });
});

test("reduceComment: backspace deletes before the caret", () => {
  const result = reduceComment({ text: "abc", caret: 2 }, { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "ac", caret: 1 } });
});

test("reduceComment: a multi-char paste chunk inserts whole at the caret", () => {
  const result = reduceComment({ text: "ad", caret: 1 }, { kind: "char", ch: "bc" });
  assert.deepEqual(result, { state: { text: "abcd", caret: 3 } });
});

// Grapheme-boundary movement (CJK, emoji, combining marks) ----------------------

test("reduceComment: left and right move one CJK character at a time", () => {
  // Each Han character is one code unit here, but the cluster walk must
  // still land on its boundary (regression guard for the segmenter wiring).
  let st: CommentState = { text: "\u4e2d\u6587", caret: 0 };
  st = reduceComment(st, { kind: "right" }).state;
  assert.equal(st.caret, 1);
  st = reduceComment(st, { kind: "right" }).state;
  assert.equal(st.caret, 2);
  st = reduceComment(st, { kind: "left" }).state;
  assert.equal(st.caret, 1);
});

test("reduceComment: left moves across an astral emoji whole", () => {
  // U+1F44D thumbs-up is 2 code units; left lands before the whole emoji.
  const st = reduceComment(end("a\u{1F44D}"), { kind: "left" }).state;
  assert.equal(st.caret, 1);
  const again = reduceComment(st, { kind: "left" }).state;
  assert.equal(again.caret, 0);
});

test("reduceComment: right moves across an emoji ZWJ sequence whole", () => {
  // Family emoji: man + ZWJ + woman + ZWJ + girl = 8 code units, one grapheme.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  assert.equal(family.length, 8);
  const st = reduceComment({ text: family, caret: 0 }, { kind: "right" });
  assert.deepEqual(st, { state: { text: family, caret: 8 } });
});

test("reduceComment: left crosses a combining-mark cluster whole", () => {
  // "e" + combining acute = one grapheme; left lands before the base char.
  const st = reduceComment(end("e\u0301"), { kind: "left" }).state;
  assert.equal(st.caret, 0);
  const again = reduceComment(st, { kind: "left" });
  assert.deepEqual(again, { state: { text: "e\u0301", caret: 0 } }); // no-op at start
});

test("reduceComment: right at end-of-text is a no-op, left at start too", () => {
  const atEnd = reduceComment(end("ab"), { kind: "right" });
  assert.deepEqual(atEnd, { state: { text: "ab", caret: 2 } });
  const atStart = reduceComment({ text: "ab", caret: 0 }, { kind: "left" });
  assert.deepEqual(atStart, { state: { text: "ab", caret: 0 } });
});

// Soft-wrap crossing: pure offset stepping --------------------------------------
//
// The caret model is the INSERTION POINT (cursorCellAt): a caret offset
// renders the grapheme at its insertion column, or the row-end blank cell
// when the column is at the row's width. A shared soft-wrap boundary
// belongs to the FOLLOWING row (wrapCommentLines), so the boundary offset
// paints the next row's first cell while one cluster step back paints the
// previous row's last cell. Left/right are pure cluster steps in offset
// space, so ONE press always visibly crosses a soft wrap - no (row, col)
// round-trip, no boundary special case.

// The rendered caret identity for an offset: row, cell text, and the text
// before the cell (distinguishes repeated characters within a row).
const paintedCell = (text: string, width: number, caret: number) => {
  const wrapped = wrapCommentLines(text, width, caret);
  const line = wrapped.lines[wrapped.cursorRow];
  const { before, cell } = cursorCellAt(line, wrapped.cursorCol);
  return `${wrapped.cursorRow}:${before.length}:${cell}`;
};

test("reduceComment: one Right crosses a soft wrap onto the next row's first cell", () => {
  // Width 3 wraps "abcdef" into "abc" [0,3) / "def" [3,6); caret 2 paints
  // row 0's last cell 'c'. One Right must land on the boundary offset 3,
  // which the following-row rule renders as row 1's first cell 'd' - the
  // old left-of-insertion model painted row 0's 'c' there instead and
  // swallowed the press.
  const st = reduceComment({ text: "abcdef", caret: 2 }, { kind: "right" }, 3).state;
  assert.equal(st.caret, 3);
  const wrapped = wrapCommentLines(st.text, 3, st.caret);
  assert.equal(wrapped.cursorRow, 1);
  assert.deepEqual(cursorCellAt(wrapped.lines[1], wrapped.cursorCol), { before: "", cell: "d", after: "ef" });
});

test("reduceComment: one Left crosses a soft wrap back onto the previous row's last cell", () => {
  // Caret 3 paints row 1's first cell 'd'; a single Left must land on the
  // caret that paints row 0's last cell 'c' - not skip past it.
  const st = reduceComment({ text: "abcdef", caret: 3 }, { kind: "left" }, 3).state;
  assert.equal(st.caret, 2);
  const wrapped = wrapCommentLines(st.text, 3, st.caret);
  assert.equal(wrapped.cursorRow, 0);
  assert.deepEqual(cursorCellAt(wrapped.lines[0], wrapped.cursorCol), { before: "ab", cell: "c", after: "" });
});

test("reduceComment: a left/right sweep over wrapped text moves the rendered cell every press", () => {
  // Same-cell monotonicity: every press lands on a caret offset that paints
  // a DIFFERENT cell than before - including the first press out of the
  // absolute start, whose insertion caret moves from the first cell to the
  // second (the old model painted the same first cell for both offsets).
  // The fixture mixes a wide char, a space, and soft wraps.
  const text = "ab\u4e2dcd x";
  const width = 3; // rows: "ab" [0,2) / "\u4e2dc" [2,4) / "d x" [4,7)
  let st: CommentState = { text, caret: 0 };
  const cells: string[] = [paintedCell(st.text, width, st.caret)];
  while (st.caret < text.length) {
    st = reduceComment(st, { kind: "right" }, width).state;
    assert.ok(st.caret > 0, "right moves the caret");
    cells.push(paintedCell(st.text, width, st.caret));
  }
  assert.deepEqual(reduceComment(st, { kind: "right" }, width), { state: st }); // absolute end: visible no-op
  assert.equal(cells.length, 8); // 7 clusters: the start plus 7 moving presses
  for (let k = 1; k < cells.length; k++) {
    assert.notEqual(cells[k], cells[k - 1], `right press ${k - 1} must change the rendered cell`);
  }
  const leftCells: string[] = [];
  while (st.caret > 0) {
    leftCells.push(paintedCell(st.text, width, st.caret));
    st = reduceComment(st, { kind: "left" }, width).state;
  }
  leftCells.push(paintedCell(st.text, width, st.caret));
  assert.deepEqual(reduceComment(st, { kind: "left" }, width), { state: st }); // absolute start: visible no-op
  assert.equal(leftCells.length, 8);
  for (let k = 1; k < leftCells.length; k++) {
    assert.notEqual(leftCells[k], leftCells[k - 1], `left press ${k - 1} must change the rendered cell`);
  }
});

test("reduceComment: backspace deletes a whole emoji", () => {
  const result = reduceComment(end("a\u{1F44D}"), { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "a", caret: 1 } });
});

test("reduceComment: backspace deletes a combining-mark cluster whole", () => {
  const result = reduceComment(end("e\u0301"), { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "", caret: 0 } });
});

test("reduceComment: backspace before the caret leaves the tail alone", () => {
  // Mid-text delete: only the cluster left of the caret goes.
  const result = reduceComment({ text: "ab\u{1F44D}c", caret: 4 }, { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "abc", caret: 2 } });
});

// Home/end on wrapped rows ------------------------------------------------------

test("reduceComment: home and end move to the current wrapped row's bare edges", () => {
  // Width 3 wraps "abcdef" into "abc" [0,3) and "def" [3,6).
  const st: CommentState = { text: "abcdef", caret: 4 }; // insertion before row 1's 'e'
  // Home targets the row's BARE start offset - the insertion point before
  // its first grapheme, which cursorCellAt paints as that grapheme.
  assert.equal(reduceComment(st, { kind: "home" }, 3).state.caret, 3);
  assert.equal(reduceComment(st, { kind: "end" }, 3).state.caret, 6); // row 1's end
});

test("reduceComment: a caret on a wrap boundary belongs to the following row", () => {
  // Caret 3 sits between row 0 and row 1; the following-row rule renders it
  // on row 1 at column 0 (the first cell 'd'). Home is a no-op there (the
  // bare row start), and end moves to row 1's end - the boundary no longer
  // belongs to the row that ends there.
  const atBoundary = { text: "abcdef", caret: 3 };
  const toStart = reduceComment(atBoundary, { kind: "home" }, 3).state;
  assert.equal(toStart.caret, 3);
  assert.equal(reduceComment(atBoundary, { kind: "end" }, 3).state.caret, 6);
});

test("reduceComment: home and end respect hard newlines, not just soft wraps", () => {
  // Rows: "ab" [0,2) and "cd" [3,5); the newline sits between them. The
  // hard-line end caret 2 stays on row 0 (no following soft row): its cell
  // is the row-end blank at column 2, so end is a no-op there.
  let st: CommentState = { text: "ab\ncd", caret: 2 };
  st = reduceComment(st, { kind: "end" }, 10).state;
  assert.equal(st.caret, 2); // already at the hard line's end: no-op
  st = reduceComment(st, { kind: "home" }, 10).state;
  assert.equal(st.caret, 0); // row 0's bare start
  st = reduceComment(st, { kind: "end" }, 10).state;
  assert.equal(st.caret, 2);
  st = reduceComment(st, { kind: "down" }, 10).state;
  st = reduceComment(st, { kind: "home" }, 10).state;
  assert.equal(st.caret, 3); // row 1's bare start
  st = reduceComment(st, { kind: "end" }, 10).state;
  assert.equal(st.caret, 5);
});

test("reduceComment: home and end are no-ops when the caret is already on the edge", () => {
  // End at the absolute text end (the last row's row-end blank) and home at
  // a bare row start are bit-for-bit no-ops; the soft-wrap boundary caret 3
  // is row 1's bare start, so home is a no-op there too.
  const atEnd = { text: "abcdef", caret: 6 };
  assert.deepEqual(reduceComment(atEnd, { kind: "end" }, 3), { state: atEnd });
  const atRowStart: CommentState = { text: "abcdef", caret: 0 };
  assert.deepEqual(reduceComment(atRowStart, { kind: "home" }, 3), { state: atRowStart });
  assert.deepEqual(reduceComment({ text: "abc", caret: 0 }, { kind: "home" }, 80).state, { text: "abc", caret: 0 });
  const atBoundary: CommentState = { text: "abcdef", caret: 3 };
  assert.deepEqual(reduceComment(atBoundary, { kind: "home" }, 3), { state: atBoundary });
});

test("reduceComment: home and end aim across wide characters without splitting them", () => {
  // Width 3 wraps "\u4e2dbc" (the wide char is 2 columns) into "\u4e2db"
  // [0,2) and "c" [2,3). From caret 1 (the insertion point between the wide
  // char and 'b', display column 2), home goes to the row's bare start 0 -
  // the insertion point before the wide char - and end to the row's end
  // offset 2 (the boundary, rendered on the next row). From there, end
  // reaches the absolute end and home returns to row 1's bare start.
  let st: CommentState = { text: "\u4e2dbc", caret: 1 };
  st = reduceComment(st, { kind: "home" }, 3).state;
  assert.equal(st.caret, 0);
  st = reduceComment(st, { kind: "end" }, 3).state;
  assert.equal(st.caret, 2); // row 0's end offset
  st = reduceComment(st, { kind: "end" }, 3).state; // from the boundary: row 1's end
  assert.equal(st.caret, 3);
  st = reduceComment(st, { kind: "home" }, 3).state;
  assert.equal(st.caret, 2); // row 1's bare start
});

// Up/down across soft-wrap boundaries with goal-column memory -------------------

test("reduceComment: up and down move between wrapped rows at the same column", () => {
  // Width 5 wraps "aaaa bbbb cccc" into "aaaa " [0,5), "bbbb " [5,10),
  // "cccc" [10,14). The end caret sits in row 2's row-end blank (column 4),
  // and its goal column 4 clamps each shorter row's aim to that row's end:
  // the insertion point after its last cluster (the row-end blank).
  let st = end("aaaa bbbb cccc");
  st = reduceComment(st, { kind: "up" }, 5).state;
  assert.equal(st.caret, 9); // row 1: the insertion point before its trailing space (column 4)
  st = reduceComment(st, { kind: "up" }, 5).state;
  assert.equal(st.caret, 4); // row 0: the insertion point before its trailing space (column 4)
  st = reduceComment(st, { kind: "down" }, 5).state;
  assert.equal(st.caret, 9);
  st = reduceComment(st, { kind: "down" }, 5).state;
  assert.equal(st.caret, 14);
});

test("reduceComment: the goal column survives clamping on narrower rows", () => {
  // Width 4 wraps "abcd\u4e2defgh" into "abcd" (4 cols), "\u4e2def" (4 cols),
  // "gh" (2 cols). From the end (row 2, caret column 2) up aims at column 2:
  // the insertion point before the cluster covering that column ('e').
  // The second up must aim at the ORIGINAL column 2 ('c'), not the resting
  // column the new caret would seed without memory.
  const text = "abcd\u4e2defgh";
  let st = end(text);
  st = reduceComment(st, { kind: "up" }, 4).state;
  assert.equal(st.caret, 5); // row 1, before 'e' (goal column 2)
  st = reduceComment(st, { kind: "up" }, 4).state;
  assert.equal(st.caret, 2); // row 0, before 'c' (goal memory)
  st = reduceComment(st, { kind: "down" }, 4).state;
  assert.equal(st.caret, 5);
  st = reduceComment(st, { kind: "down" }, 4).state;
  assert.equal(st.caret, 9); // back to the end
});

test("reduceComment: up and down place the caret without splitting wide characters", () => {
  // Width 1 wraps "\u4e2dx" into "\u4e2d" (2 cols) / "x"; a goal column of 1
  // falls inside the wide char, so up aims at the insertion point before
  // that whole cluster (offset 0) - never a split, and the painted cell is
  // the whole wide char.
  let st = end("\u4e2dx");
  st = reduceComment(st, { kind: "up" }, 1).state; // goal 1 -> inside the wide char: the point before it
  assert.equal(st.caret, 0);
  st = reduceComment(st, { kind: "down" }, 1).state;
  assert.equal(st.caret, 2);
});

test("reduceComment: up at the first row and down at the last are no-ops", () => {
  const atEnd = end("ab");
  assert.deepEqual(reduceComment(atEnd, { kind: "down" }, 3), { state: atEnd });
  const atStart: CommentState = { text: "ab", caret: 0 };
  assert.deepEqual(reduceComment(atStart, { kind: "up" }, 3), { state: atStart });
});

test("reduceComment: horizontal movement clears the remembered goal column", () => {
  // "aaaa bbbb cccc" at width 5: caret 4 (row 0 col 4), down to row 1, left
  // (clears the goal), down -> the new goal is the CURRENT column, not 4.
  let st = end("aaaa bbbb cccc");
  st = reduceComment(st, { kind: "down" }, 5).state; // caret 9, goal 4
  st = reduceComment(st, { kind: "left" }, 5).state; // caret 8, goal cleared
  st = reduceComment(st, { kind: "down" }, 5).state; // goal 3 -> caret 13
  assert.equal(st.caret, 13);
});

test("reduceComment: editing clears the remembered goal column", () => {
  // "aaaa bbbb cccc" at width 5: up from the end to row 1's trailing-space
  // insertion point (caret 9, goal 4), insert "z" there (clears the goal).
  // The next up must aim at the CURRENT caret column (0), not the
  // remembered 4.
  let st = end("aaaa bbbb cccc");
  st = reduceComment(st, { kind: "up" }, 5).state; // caret 9 (before row 1's trailing space), goal 4
  st = reduceComment(st, { kind: "char", ch: "z" }, 5).state; // text "aaaa bbbbz cccc", caret 10
  st = reduceComment(st, { kind: "up" }, 5).state; // row 2 column 0 -> row 1 column 0
  assert.equal(st.caret, 5); // remembered goal 4 would land at 9
});

// Reducer equivalence: caret at end-of-text matches append-only semantics -------

test("reduceComment: end-of-text caret reproduces the append-only reducer", () => {
  // For BMP text (where the old code-unit backspace was whole characters),
  // char/newline/backspace at caret = text.length produce exactly the old
  // append-only results.
  assert.deepEqual(reduceComment(end("ab"), { kind: "char", ch: "c" }).state, { text: "abc", caret: 3 });
  assert.deepEqual(reduceComment(end("ab"), { kind: "newline" }).state, { text: "ab\n", caret: 3 });
  assert.deepEqual(reduceComment(end("abc"), { kind: "backspace" }).state, { text: "ab", caret: 2 });
  assert.deepEqual(reduceComment(end(""), { kind: "backspace" }).state, { text: "", caret: 0 });
  assert.deepEqual(reduceComment(end("ab"), { kind: "submit" }), {
    state: { text: "ab", caret: 2 },
    effect: { type: "submit", text: "ab" },
  });
  assert.deepEqual(reduceComment(end("ab"), { kind: "cancel" }), {
    state: { text: "ab", caret: 2 },
    effect: { type: "cancel" },
  });
});

test("reduceComment: a multi-key session at the end builds the same text as appending", () => {
  const session: ({ kind: "char"; ch: string } | { kind: "newline" } | { kind: "backspace" })[] = [
    { kind: "char", ch: "h" },
    { kind: "char", ch: "i" },
    { kind: "newline" },
    { kind: "char", ch: "yo" },
    { kind: "backspace" },
  ];
  let st = end("");
  for (const k of session) st = reduceComment(st, k, 80).state;
  assert.deepEqual(st, { text: "hi\ny", caret: 4 });
});

// wrapCommentLines -------------------------------------------------------------

test("wrapCommentLines: empty text is one empty row with the cursor at 0,0", () => {
  assert.deepEqual(wrapCommentLines("", 10, 0), {
    lines: [""],
    rowStarts: [0],
    rowEnds: [0],
    cursorRow: 0,
    cursorCol: 0,
  });
});

test("wrapCommentLines: short text stays on one row", () => {
  const w = wrapCommentLines("hello", 10, 5);
  assert.deepEqual(w.lines, ["hello"]);
  assert.deepEqual(w.rowStarts, [0]);
  assert.deepEqual(w.rowEnds, [5]);
  assert.equal(w.cursorRow, 0);
  assert.equal(w.cursorCol, 5);
});

test("wrapCommentLines: soft-wraps at the width boundary", () => {
  const w = wrapCommentLines("abcdef", 3, 6);
  assert.deepEqual(w.lines, ["abc", "def"]);
  assert.deepEqual(w.rowStarts, [0, 3]);
  assert.deepEqual(w.rowEnds, [3, 6]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 3);
});

test("wrapCommentLines: a caret on a soft-wrap boundary belongs to the following row", () => {
  const w = wrapCommentLines("abcdef", 3, 3);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 0);
});

test("wrapCommentLines: a hard-line end caret stays on its row at the row-end blank column", () => {
  // Caret 2 is the end of the hard line "ab"; it has no following soft row,
  // so it stays on row 0 with cursorCol = the row's width (the row-end
  // blank cell). The absolute text end behaves the same on the last row.
  const w = wrapCommentLines("ab\ncd", 10, 2);
  assert.equal(w.cursorRow, 0);
  assert.equal(w.cursorCol, 2);
  const atEnd = wrapCommentLines("ab\ncd", 10, 5);
  assert.equal(atEnd.cursorRow, 1);
  assert.equal(atEnd.cursorCol, 2);
});

test("wrapCommentLines: hard newlines split rows regardless of width", () => {
  const w = wrapCommentLines("ab\ncd", 10, 2); // cursor before the newline
  assert.deepEqual(w.lines, ["ab", "cd"]);
  assert.deepEqual(w.rowStarts, [0, 3]);
  assert.deepEqual(w.rowEnds, [2, 5]);
  assert.equal(w.cursorRow, 0); // boundary: end of the first row
  assert.equal(w.cursorCol, 2);
  const after = wrapCommentLines("ab\ncd", 10, 3); // cursor after the newline
  assert.equal(after.cursorRow, 1);
  assert.equal(after.cursorCol, 0);
});

test("wrapCommentLines: cursor after a trailing newline maps to a new empty row", () => {
  const w = wrapCommentLines("ab\n", 10, 3);
  assert.deepEqual(w.lines, ["ab", ""]);
  assert.deepEqual(w.rowStarts, [0, 3]);
  assert.deepEqual(w.rowEnds, [2, 3]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 0);
});

test("wrapCommentLines: cursor maps into the middle of a wrapped row", () => {
  const w = wrapCommentLines("abcdefgh", 3, 4);
  assert.deepEqual(w.lines, ["abc", "def", "gh"]);
  assert.deepEqual(w.rowStarts, [0, 3, 6]);
  assert.deepEqual(w.rowEnds, [3, 6, 8]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 1);
});

test("wrapCommentLines: wide chars move to the next row instead of splitting", () => {
  const w = wrapCommentLines("\u4e2d\u4e2d", 3, 4); // each 2 columns wide, width 3
  assert.deepEqual(w.lines, ["\u4e2d", "\u4e2d"]);
  assert.deepEqual(w.rowStarts, [0, 1]);
  assert.deepEqual(w.rowEnds, [1, 2]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 2);
});

test("wrapCommentLines: a combining mark adds no width to its cluster", () => {
  // "e" + combining acute is ONE 1-column glyph: two clusters fit a 2-column
  // row, and the end caret's column is 2, never the code-unit count 3.
  const w = wrapCommentLines("e\u0301x", 2, 3);
  assert.deepEqual(w.lines, ["e\u0301x"]);
  assert.deepEqual(w.rowStarts, [0]);
  assert.deepEqual(w.rowEnds, [3]);
  assert.equal(w.cursorCol, 2);
});

test("wrapCommentLines: clamps an out-of-range cursor to the text end", () => {
  const w = wrapCommentLines("ab", 10, 99);
  assert.equal(w.cursorRow, 0);
  assert.equal(w.cursorCol, 2);
});

test("wrapCommentLines: every row respects the width", () => {
  const text = "one two three four five six seven";
  const w = wrapCommentLines(text, 7, text.length);
  const widths = w.lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length);
  for (const width of widths) assert.ok(width <= 7, `row wider than 7: ${w.lines[widths.indexOf(width)]}`);
  assert.equal(w.lines.join(""), text); // no content lost
});

test("wrapCommentLines: row starts and ends are absolute code-unit offsets", () => {
  // Mixed hard and soft breaks: width 3 wraps "abcd\nef" into "abc", "d",
  // "ef" with offsets spanning the newline.
  const w = wrapCommentLines("abcd\nef", 3, 7);
  assert.deepEqual(w.lines, ["abc", "d", "ef"]);
  assert.deepEqual(w.rowStarts, [0, 3, 5]);
  assert.deepEqual(w.rowEnds, [3, 4, 7]);
});

test("wrapCommentLines: an emoji ZWJ sequence is one 2-column cluster", () => {
  // The family emoji renders as ONE glyph of 2 columns; its 8 code units
  // count as 2 display columns, never their sum.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  // Caret 10 = the insertion point after the family emoji (before "cd"),
  // rendered at display column a(1) + b(1) + family(2) = 4.
  const w = wrapCommentLines("ab" + family + "cd", 20, 10);
  assert.deepEqual(w.lines, ["ab" + family + "cd"]);
  assert.equal(w.cursorCol, 4); // a(1) + b(1) + family(2)
});

test("wrapCommentLines: a cluster never splits across rows", () => {
  // Width 4: "ab" fills 2 columns, the family emoji takes the remaining 2,
  // and "cd" overflows to the next row whole.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const w = wrapCommentLines("ab" + family + "cd", 4, 12);
  assert.deepEqual(w.lines, ["ab" + family, "cd"]);
  assert.deepEqual(w.rowStarts, [0, 10]);
  assert.deepEqual(w.rowEnds, [10, 12]);
});

test("reduceComment: up and down aim across emoji clusters without splitting them", () => {
  // Width 2: the family emoji row is 2 columns, "x" wraps to row 1. Up from
  // "x" with goal column 1 falls inside the 2-column emoji and aims at the
  // insertion point before it (offset 0) - the painted cell is the whole
  // emoji.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  let st = end(family + "x");
  st = reduceComment(st, { kind: "up" }, 2).state;
  assert.equal(st.caret, 0);
  st = reduceComment(st, { kind: "down" }, 2).state;
  assert.equal(st.caret, 9);
});

test("reduceComment: up from a full row's end clamps to the row above's last occupied cell", () => {
  // Regression: 120 one-column chars at width 60 wrap into two full rows
  // [0,60) / [60,120). Up from the absolute end used to aim at column 60 of
  // row 0, whose caret offset 60 is the shared soft-wrap boundary - it
  // rendered back on row 1 and the next Up was a no-op, making row 0
  // unreachable. Vertical movement into a row that ends at a shared
  // soft-wrap boundary clamps the aim to that row's last occupied cell
  // (width - 1) while PRESERVING the original goal column.
  const text = "b".repeat(120);
  let st = end(text);
  st = reduceComment(st, { kind: "up" }, 60).state;
  assert.equal(st.caret, 59); // row 0's last occupied cell, not the boundary 60
  assert.equal(st.goalCol, 60); // original goal preserved for later motion
  const wrapped = wrapCommentLines(st.text, 60, st.caret);
  assert.equal(wrapped.cursorRow, 0);
  assert.equal(wrapped.cursorCol, 59);
  const steady = reduceComment(st, { kind: "up" }, 60);
  assert.deepEqual(steady.state, st); // at the top: harmless no-op
  const back = reduceComment(st, { kind: "down" }, 60).state; // the preserved goal still aims at the end
  assert.equal(back.caret, 120);
});

test("reduceComment: vertical clamping aims at whole clusters on an exact-full-row wide grapheme", () => {
  // 60 two-column wide chars at width 60: two exact-full rows of 30 wide
  // chars. Up from the end clamps the aim to column 59, which falls INSIDE
  // the last wide char (columns 58-59) - the caret lands on the insertion
  // point before that whole cluster (offset 29), never a split, and the
  // preserved goal 60 still reaches the absolute end on the way back down.
  const text = "\u4e2d".repeat(60);
  let st = end(text);
  st = reduceComment(st, { kind: "up" }, 60).state;
  assert.equal(st.caret, 29);
  assert.equal(st.goalCol, 60);
  const wrapped = wrapCommentLines(st.text, 60, st.caret);
  assert.equal(wrapped.cursorRow, 0);
  assert.equal(wrapped.cursorCol, 58);
  st = reduceComment(st, { kind: "down" }, 60).state;
  assert.equal(st.caret, 60);
});

// cursorCellAt ----------------------------------------------------------------

test("cursorCellAt: the caret cell is the grapheme at the insertion column", () => {
  // col is the caret's insertion column; the painted cell is the cluster
  // occupying that column - the grapheme the insertion point sits before.
  assert.deepEqual(cursorCellAt("abc", 0), { before: "", cell: "a", after: "bc" });
  assert.deepEqual(cursorCellAt("abc", 1), { before: "a", cell: "b", after: "c" });
  assert.deepEqual(cursorCellAt("abc", 2), { before: "ab", cell: "c", after: "" });
});

test("cursorCellAt: a column at or past the row's width is the row-end blank cell", () => {
  // The absolute end and any clamped column place a blank insertion cell
  // AFTER the row's text (it rides the frame's right-padding cell).
  assert.deepEqual(cursorCellAt("", 0), { before: "", cell: " ", after: "" });
  assert.deepEqual(cursorCellAt("abc", 3), { before: "abc", cell: " ", after: "" });
  assert.deepEqual(cursorCellAt("ab", 2), { before: "ab", cell: " ", after: "" });
  assert.deepEqual(cursorCellAt("ab", 9), { before: "ab", cell: " ", after: "" }); // past the end: same clamp
});

test("cursorCellAt: takes the whole wide char covering the insertion column", () => {
  // An insertion column falling inside the 2-column glyph takes the whole
  // cluster, never a split.
  assert.deepEqual(cursorCellAt("\u4e2dx", 0), { before: "", cell: "\u4e2d", after: "x" });
  assert.deepEqual(cursorCellAt("\u4e2dx", 1), { before: "", cell: "\u4e2d", after: "x" });
  assert.deepEqual(cursorCellAt("\u4e2dx", 2), { before: "\u4e2d", cell: "x", after: "" });
  assert.deepEqual(cursorCellAt("\u4e2dx", 3), { before: "\u4e2dx", cell: " ", after: "" });
});

test("cursorCellAt: takes an emoji ZWJ sequence whole", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  assert.deepEqual(cursorCellAt(family + "x", 0), { before: "", cell: family, after: "x" });
  assert.deepEqual(cursorCellAt(family + "x", 1), { before: "", cell: family, after: "x" }); // inside the 2-column glyph
  assert.deepEqual(cursorCellAt(family + "x", 2), { before: family, cell: "x", after: "" });
});

test("cursorCellAt: takes a combining-mark cluster whole", () => {
  const e = "e\u0301x";
  assert.deepEqual(cursorCellAt(e, 0), { before: "", cell: "e\u0301", after: "x" });
  assert.deepEqual(cursorCellAt(e, 1), { before: "e\u0301", cell: "x", after: "" });
});

test("cursorCellAt: parts reassemble to the row (width preserving)", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  const rows: [string, number][] = [["abc", 2], [family + "x", 1], ["e\u0301x", 0], ["abc", 3], ["", 0]];
  for (const [row, col] of rows) {
    const { before, cell, after } = cursorCellAt(row, col);
    // In-row cells split the row exactly; the row-end blank cell keeps the
    // whole row as `before` and adds exactly one blank.
    assert.ok(before + cell + after === row || (cell === " " && before === row && after === ""));
  }
});
