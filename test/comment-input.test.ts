import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";

import { reduceComment } from "../src/comment-input.ts";
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






