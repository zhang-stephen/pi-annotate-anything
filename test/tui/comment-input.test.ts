import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";

import { reduceComment, withCursorCell, wrapCommentLines } from "../../src/tui/comment-input.ts";
import type { CommentState } from "../../src/tui/comment-input.ts";

// ANSI inverse-video wrapper, same shape the plan uses for width-preservation
// checks (marker wrappers like "<s>" would change the visible width).
const style = (s: string) => `\x1b[7m${s}\x1b[27m`;
const visibleWidth = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

test("reduceComment: char appends to text", () => {
  const result = reduceComment({ text: "ab" }, { kind: "char", ch: "c" });
  assert.deepEqual(result, { state: { text: "abc" } });
});

test("reduceComment: newline inserts a newline", () => {
  const result = reduceComment({ text: "ab" }, { kind: "newline" });
  assert.deepEqual(result, { state: { text: "ab\n" } });
});

test("reduceComment: backspace deletes the last char", () => {
  const result = reduceComment({ text: "abc" }, { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "ab" } });
});

test("reduceComment: backspace deletes a trailing newline", () => {
  const result = reduceComment({ text: "a\n" }, { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "a" } });
});

test("reduceComment: backspace on empty text keeps state", () => {
  const result = reduceComment({ text: "" }, { kind: "backspace" });
  assert.deepEqual(result, { state: { text: "" } });
});

test("reduceComment: submit emits the current text", () => {
  const result = reduceComment({ text: "hi" }, { kind: "submit" });
  assert.deepEqual(result, {
    state: { text: "hi" },
    effect: { type: "submit", text: "hi" },
  });
});

test("reduceComment: submit with empty text is allowed", () => {
  const result = reduceComment({ text: "" }, { kind: "submit" });
  assert.deepEqual(result, {
    state: { text: "" },
    effect: { type: "submit", text: "" },
  });
});

test("reduceComment: cancel emits a cancel effect", () => {
  const result = reduceComment({ text: "hi" }, { kind: "cancel" });
  assert.deepEqual(result, {
    state: { text: "hi" },
    effect: { type: "cancel" },
  });
});

test("reduceComment: does not mutate the input state", () => {
  const state: CommentState = { text: "keep" };
  reduceComment(state, { kind: "char", ch: "x" });
  reduceComment(state, { kind: "backspace" });
  reduceComment(state, { kind: "submit" });
  assert.equal(state.text, "keep");
});

// wrapCommentLines -------------------------------------------------------------

const stripped = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("wrapCommentLines: empty text is one empty row with the cursor at 0,0", () => {
  assert.deepEqual(wrapCommentLines("", 10, 0), { lines: [""], cursorRow: 0, cursorCol: 0 });
});

test("wrapCommentLines: short text stays on one row", () => {
  const w = wrapCommentLines("hello", 10, 5);
  assert.deepEqual(w.lines, ["hello"]);
  assert.equal(w.cursorRow, 0);
  assert.equal(w.cursorCol, 5);
});

test("wrapCommentLines: soft-wraps at the width boundary", () => {
  const w = wrapCommentLines("abcdef", 3, 6);
  assert.deepEqual(w.lines, ["abc", "def"]);
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
  assert.equal(w.cursorRow, 0); // boundary: end of the first row
  assert.equal(w.cursorCol, 2);
  const after = wrapCommentLines("ab\ncd", 10, 3); // cursor after the newline
  assert.equal(after.cursorRow, 1);
  assert.equal(after.cursorCol, 0);
});

test("wrapCommentLines: cursor after a trailing newline maps to a new empty row", () => {
  const w = wrapCommentLines("ab\n", 10, 3);
  assert.deepEqual(w.lines, ["ab", ""]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 0);
});

test("wrapCommentLines: cursor maps into the middle of a wrapped row", () => {
  const w = wrapCommentLines("abcdefgh", 3, 4);
  assert.deepEqual(w.lines, ["abc", "def", "gh"]);
  assert.equal(w.cursorRow, 1);
  assert.equal(w.cursorCol, 1);
});

test("wrapCommentLines: wide chars move to the next row instead of splitting", () => {
  const w = wrapCommentLines("\u4e2d\u4e2d", 3, 4); // each 2 columns wide, width 3
  assert.deepEqual(w.lines, ["\u4e2d", "\u4e2d"]);
  assert.equal(w.cursorRow, 1);
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






