import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";

import { reduceComment, renderCommentBox } from "../src/comment-input.ts";
import type { CommentState } from "../src/comment-input.ts";

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

test("renderCommentBox: bordered box with prompt line and raw text lines", () => {
  const lines = renderCommentBox({ text: "hello\nworld" }, 20, (s) => s);
  assert.equal(lines.length, 5);
  assert.equal(lines[0], "+" + "-".repeat(18) + "+");
  assert.equal(lines[1], "| Comment:" + " ".repeat(9) + "|");
  assert.equal(lines[2], "| hello" + " ".repeat(12) + "|");
  assert.equal(lines[3], "| world" + " ".repeat(12) + "|");
  assert.equal(lines[4], "+" + "-".repeat(18) + "+");
  for (const line of lines) {
    assert.equal(visibleWidth(line), 20);
  }
});

test("renderCommentBox: empty text renders a single empty content line", () => {
  const lines = renderCommentBox({ text: "" }, 12, (s) => s);
  assert.equal(lines.length, 4);
  assert.equal(lines[2], "|" + " ".repeat(10) + "|");
  for (const line of lines) {
    assert.equal(visibleWidth(line), 12);
  }
});

test("renderCommentBox: theme styles the border and the prompt label", () => {
  const lines = renderCommentBox({ text: "" }, 12, style);
  assert.equal(lines[0], style("+" + "-".repeat(10) + "+"));
  assert.equal(lines[1], "| " + style("Comment:") + " ".repeat(1) + "|");
  assert.equal(lines[lines.length - 1], style("+" + "-".repeat(10) + "+"));
  for (const line of lines) {
    assert.equal(visibleWidth(line), 12);
  }
});

test("renderCommentBox: trailing newline renders an empty trailing line", () => {
  const lines = renderCommentBox({ text: "a\n" }, 14, (s) => s);
  assert.equal(lines.length, 5);
  assert.equal(lines[2], "| a" + " ".repeat(10) + "|");
  assert.equal(lines[3], "|" + " ".repeat(12) + "|");
  for (const line of lines) {
    assert.equal(visibleWidth(line), 14);
  }
});

test("renderCommentBox: text wider than the box is never truncated", () => {
  const long = "x".repeat(30);
  const lines = renderCommentBox({ text: long }, 10, (s) => s);
  assert.ok(lines.join("\n").includes(long));
});

test("renderCommentBox: wide chars do not break the right border", () => {
  // Two wide chars occupy 4 display columns (4 code units), so padding must
  // shrink by visible width or the border would land past column 14.
  const lines = renderCommentBox({ text: "\u4e00\u4e00" }, 14, (s) => s);
  assert.equal(lines[2], "| \u4e00\u4e00" + " ".repeat(7) + "|");
  assert.equal(tuiVisibleWidth(lines[2]), 14);
});
