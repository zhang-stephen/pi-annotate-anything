import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";

import { reduceComment, withCursorCell, wrapCommentLines } from "../../src/tui/comment-input.ts";
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

test("reduceComment: home and end move to the current wrapped row's edges", () => {
  // Width 3 wraps "abcdef" into "abc" [0,3) and "def" [3,6).
  const st: CommentState = { text: "abcdef", caret: 4 };
  assert.equal(reduceComment(st, { kind: "home" }, 3).state.caret, 3); // row 1's start
  assert.equal(reduceComment(st, { kind: "end" }, 3).state.caret, 6); // row 1's end
});

test("reduceComment: a caret on a wrap boundary belongs to the row that ends there", () => {
  // Caret 3 sits at the end of row 0; end stays (no-op), home goes to 0.
  const atBoundary = { text: "abcdef", caret: 3 };
  const toStart = reduceComment(atBoundary, { kind: "home" }, 3).state;
  assert.equal(toStart.caret, 0);
  const stays = reduceComment(atBoundary, { kind: "end" }, 3);
  assert.deepEqual(stays, { state: atBoundary });
});

test("reduceComment: home and end respect hard newlines, not just soft wraps", () => {
  // Rows: "ab" [0,2) and "cd" [3,5); the newline sits between them.
  let st: CommentState = { text: "ab\ncd", caret: 4 };
  st = reduceComment(st, { kind: "home" }, 10).state;
  assert.equal(st.caret, 3);
  st = reduceComment(st, { kind: "end" }, 10).state;
  assert.equal(st.caret, 5);
});

test("reduceComment: home and end are no-ops when the caret is already on the edge", () => {
  const at = { text: "abcdef", caret: 3 };
  assert.deepEqual(reduceComment(at, { kind: "end" }, 3), { state: at });
  const atStart = { text: "abcdef", caret: 0 };
  assert.deepEqual(reduceComment(atStart, { kind: "home" }, 3), { state: atStart });
});

test("reduceComment: home and end aim inside wide characters without splitting them", () => {
  // Width 3 wraps "\u4e2d\u4e2d" into two 2-column rows (a wide char that
  // does not fit starts the next row whole). The end-of-text caret is the
  // second row's end, so home moves to that row's start; from the first
  // row's start, end moves to the first row's end (the boundary).
  let st: CommentState = end("\u4e2d\u4e2d");
  st = reduceComment(st, { kind: "home" }, 3).state;
  assert.equal(st.caret, 1);
  st = reduceComment(st, { kind: "left" }, 3).state; // caret 0: first row's start
  st = reduceComment(st, { kind: "end" }, 3).state;
  assert.equal(st.caret, 1); // first row's end
});

// Up/down across soft-wrap boundaries with goal-column memory -------------------

test("reduceComment: up and down move between wrapped rows at the same column", () => {
  // Width 5 wraps "aaaa bbbb cccc" into "aaaa " [0,5), "bbbb " [5,10),
  // "cccc" [10,14). End-of-text caret sits at row 2 col 4.
  let st = end("aaaa bbbb cccc");
  st = reduceComment(st, { kind: "up" }, 5).state;
  assert.equal(st.caret, 9); // row 1, col 4
  st = reduceComment(st, { kind: "up" }, 5).state;
  assert.equal(st.caret, 4); // row 0, col 4
  st = reduceComment(st, { kind: "down" }, 5).state;
  assert.equal(st.caret, 9);
  st = reduceComment(st, { kind: "down" }, 5).state;
  assert.equal(st.caret, 14);
});

test("reduceComment: the goal column survives clamping on narrower rows", () => {
  // Width 4 wraps "abcd\u4e2defgh" into "abcd" (4 cols), "\u4e2def" (4 cols),
  // "gh" (2 cols). From the end (row 2, col 2) up aims at column 2; the row
  // 1 caret rests right after the wide char (column 2). The second up must
  // aim at the ORIGINAL column 2, not the resting column 3 the walk would
  // produce without memory.
  const text = "abcd\u4e2defgh";
  let st = end(text);
  st = reduceComment(st, { kind: "up" }, 4).state;
  assert.equal(st.caret, 5); // row 1, column 2 (after the 2-column char)
  st = reduceComment(st, { kind: "up" }, 4).state;
  assert.equal(st.caret, 2); // row 0, column 2 (goal memory)
  st = reduceComment(st, { kind: "down" }, 4).state;
  assert.equal(st.caret, 5);
  st = reduceComment(st, { kind: "down" }, 4).state;
  assert.equal(st.caret, 9); // back to the end
});

test("reduceComment: up and down place the caret without splitting wide characters", () => {
  // Width 1 wraps "\u4e2dx" into "\u4e2d" (2 cols) / "x"; a goal column of 1
  // falls inside the wide char, so up rests before it (column 0).
  let st = end("\u4e2dx");
  st = reduceComment(st, { kind: "up" }, 1).state; // goal 1 -> clamped to the wide char's start
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
  // "aaaa bbbb cccc" at width 5: caret 4 (row 0 col 4), up to row 1 col 4
  // (goal 4), insert "z" (clears the goal). The next up must aim at the
  // column of the inserted caret (0), not the remembered 4.
  let st = end("aaaa bbbb cccc");
  st = reduceComment(st, { kind: "up" }, 5).state; // caret 9, goal 4
  st = reduceComment(st, { kind: "char", ch: "z" }, 5).state; // text "aaaa bbbbz cccc", caret 10
  st = reduceComment(st, { kind: "up" }, 5).state; // row 2 col 0 -> row 1 col 0
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

const stripped = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

test("wrapCommentLines: cursor exactly on a wrap boundary sits at the end of the previous row", () => {
  const w = wrapCommentLines("abcdef", 3, 3);
  assert.equal(w.cursorRow, 0);
  assert.equal(w.cursorCol, 3);
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
  const w = wrapCommentLines("ab" + family + "cd", 20, 6);
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
  // "x" with goal column 1 falls inside the 2-column emoji and rests at its
  // start (column 0), never mid-cluster.
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  let st = end(family + "x");
  st = reduceComment(st, { kind: "up" }, 2).state;
  assert.equal(st.caret, 0);
  st = reduceComment(st, { kind: "down" }, 2).state;
  assert.equal(st.caret, 9);
});

// withCursorCell ---------------------------------------------------------------

const ON = "\x1b[7m";
const OFF = "\x1b[27m";

test("withCursorCell: inverts the character under the cursor column", () => {
  assert.equal(withCursorCell("abc", 1), "a" + ON + "b" + OFF + "c");
  assert.equal(stripped(withCursorCell("abc", 1)), "abc"); // width preserving
});

test("withCursorCell: at end of line renders an inverse space", () => {
  assert.equal(withCursorCell("ab", 2), "ab" + ON + " " + OFF);
  assert.equal(withCursorCell("", 0), ON + " " + OFF);
});

test("withCursorCell: inverts the whole wide char covering the cursor column", () => {
  assert.equal(withCursorCell("\u4e2dx", 1), ON + "\u4e2d" + OFF + "x");
  assert.equal(withCursorCell("\u4e2dx", 0), ON + "\u4e2d" + OFF + "x");
});

test("withCursorCell: a column past the row end falls back to the inverse space", () => {
  assert.equal(withCursorCell("ab", 9), "ab" + ON + " " + OFF);
});

test("withCursorCell: inverts an emoji ZWJ sequence whole", () => {
  const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
  assert.equal(withCursorCell(family + "x", 0), ON + family + OFF + "x");
  assert.equal(withCursorCell(family + "x", 1), ON + family + OFF + "x"); // inside the 2-column glyph
  assert.equal(stripped(withCursorCell(family + "x", 1)), family + "x"); // width preserving
});

test("withCursorCell: inverts a combining-mark cluster whole", () => {
  const e = "e\u0301x";
  assert.equal(withCursorCell(e, 0), ON + "e\u0301" + OFF + "x");
  assert.equal(stripped(withCursorCell(e, 0)), e); // width preserving
});
