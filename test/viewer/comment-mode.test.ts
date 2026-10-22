import { test } from "node:test";
import assert from "node:assert/strict";

import { reduceViewer } from "../../src/viewer/state.ts";
import { commentBoxWrapWidth, toCommentKey } from "../../src/viewer/comment-mode.ts";
import { wrapCommentLines } from "../../src/tui/comment-input.ts";
import type { PendingDraft, ViewerState } from "../../src/viewer/state.ts";

// 30-line fixture: "line 0" .. "line 29" (col max 6 for single-digit lines).
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`);
const VH = 10; // viewport height used across tests
// Default viewport opts: contentWidth far above the fixture's longest line
// (7 display columns) and its exact maxLineWidth, so no horizontal follow
// runs unless a test asks for it.
const VP = { height: VH, contentWidth: 20, maxLineWidth: 7 };

function viewer(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    mode: "normal",
    cursor: { line: 0, col: 0 },
    anchor: null,
    scrollTop: 0,
    comment: null,
    pending: null,
    visualMode: "char",
    editingDraftId: null,
    previewOn: true,
    ...overrides,
  };
}

function view(state: ViewerState, key: string, pending: PendingDraft[] = []) {
  return reduceViewer(state, key, LINES, VP, pending);
}

test("reduceViewer: c with an active selection enters comment mode", () => {
  const start = viewer({ mode: "visual-line", cursor: { line: 4, col: 3 }, anchor: { line: 2, col: 0 }, visualMode: "line" });
  const res = view(start, "c");
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "", caret: 0 });
  assert.deepEqual(res.state.anchor, { line: 2, col: 0 });
  assert.equal(res.state.visualMode, "line");
  assert.equal(res.effect, undefined);
});

function commentState(text: string, visualMode: "char" | "line" = "line"): ViewerState {
  return viewer({
    mode: "comment",
    cursor: { line: 4, col: 3 },
    anchor: { line: 2, col: 0 },
    visualMode,
    comment: { text, caret: text.length },
  });
}

test("reduceViewer: printable keys append in comment mode; cursor untouched", () => {
  let res = view(commentState(""), "h");
  assert.deepEqual(res.state.comment, { text: "h", caret: 1 });
  res = view(res.state, "i");
  assert.deepEqual(res.state.comment, { text: "hi", caret: 2 });
  assert.deepEqual(res.state.cursor, { line: 4, col: 3 });
});

test("reduceViewer: ctrl+j inserts a newline in comment mode", () => {
  const res = view(commentState("a"), "\n");
  assert.deepEqual(res.state.comment, { text: "a\n", caret: 2 });
});

test("reduceViewer: shift+enter inserts a newline in comment mode", () => {
  const res = view(commentState("ab"), "\x1b\r");
  assert.deepEqual(res.state.comment, { text: "ab\n", caret: 3 });
});

test("reduceViewer: backspace deletes the last comment char", () => {
  const res = view(commentState("ab"), "\x7f");
  assert.deepEqual(res.state.comment, { text: "a", caret: 1 });
  const empty = view(commentState(""), "\x7f");
  assert.deepEqual(empty.state.comment, { text: "", caret: 0 });
});

test("reduceViewer: q types 'q' in comment mode", () => {
  const res = view(commentState(""), "q");
  assert.deepEqual(res.state.comment, { text: "q", caret: 1 });
  assert.equal(res.effect, undefined);
});

test("reduceViewer: multi-char paste chunk is appended whole in comment mode", () => {
  const res = view(commentState(""), "hello world");
  assert.deepEqual(res.state.comment, { text: "hello world", caret: 11 });
});

test("reduceViewer: astral-plane chars append in comment mode", () => {
  const res = view(commentState(""), "\u{10348}");
  assert.deepEqual(res.state.comment, { text: "\u{10348}", caret: 2 });
});

test("reduceViewer: chunks with Esc or C0 controls are ignored in comment mode", () => {
  const start = commentState("a");
  for (const key of ["\x1b[200~", "pasted \x1b[B", "\x01"]) {
    const res = view(start, key);
    assert.deepEqual(res.state.comment, { text: "a", caret: 1 });
    assert.equal(res.effect, undefined);
  }
});

test("reduceViewer: tab characters are rejected in comment mode", () => {
  // The box renderer never expands tabs, so \t would misalign the wrap and
  // cursor column math; whole chunks containing one are ignored.
  const start = commentState("a");
  for (const key of ["\t", "x\ty"]) {
    const res = view(start, key);
    assert.deepEqual(res.state.comment, { text: "a", caret: 1 });
  }
});

test("reduceViewer: unmapped escape sequences are ignored in comment mode", () => {
  // PgUp is not a comment-input key; the canonical movement sequences below
  // are the only escapes that classify.
  const start = commentState("a");
  const res = view(start, "\x1b[5~");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

// toCommentKey: movement classification ahead of the C0 rejection -------------

test("toCommentKey: classifies the canonical legacy movement sequences", () => {
  assert.deepEqual(toCommentKey("\x1b[A"), { kind: "up" });
  assert.deepEqual(toCommentKey("\x1b[B"), { kind: "down" });
  assert.deepEqual(toCommentKey("\x1b[C"), { kind: "right" });
  assert.deepEqual(toCommentKey("\x1b[D"), { kind: "left" });
  assert.deepEqual(toCommentKey("\x1b[H"), { kind: "home" });
  assert.deepEqual(toCommentKey("\x1b[F"), { kind: "end" });
});

test("toCommentKey: still rejects other escape sequences and control chunks", () => {
  for (const key of ["\x1b[5~", "\x1bOA", "\x1b[1;5D", "\x1b[57417u", "a\x1bb", "\t"]) {
    assert.equal(toCommentKey(key), null, JSON.stringify(key));
  }
});

// Movement keys in comment mode ------------------------------------------------

test("reduceViewer: left and right move the comment caret one grapheme", () => {
  let res = view(commentState("ab\u{1F44D}"), "\x1b[D"); // before the emoji
  assert.deepEqual(res.state.comment, { text: "ab\u{1F44D}", caret: 2 });
  res = view(res.state, "\x1b[C"); // back to the end
  assert.deepEqual(res.state.comment, { text: "ab\u{1F44D}", caret: 4 });
});

test("reduceViewer: char inserts at the moved caret, not at the end", () => {
  let res = view(commentState("hello"), "\x1b[D");
  res = view(res.state, "\x1b[D");
  res = view(res.state, "XY"); // paste chunk rides at the caret
  assert.deepEqual(res.state.comment, { text: "helXYlo", caret: 5 });
});

test("reduceViewer: backspace deletes before the moved caret", () => {
  let res = view(commentState("hello"), "\x1b[D");
  res = view(res.state, "\x1b[D");
  res = view(res.state, "\x7f"); // deletes the middle 'l' (caret 3)
  assert.deepEqual(res.state.comment, { text: "helo", caret: 2 });
});

test("reduceViewer: home and end move to the wrapped row's edges", () => {
  // The default viewport wraps comments at commentBoxWrapWidth(20) columns;
  // the fixture soft-wraps there into three rows.
  const text = "aaaa bbbb cccc dddd eeee ffff gggg";
  const rows = wrapRows(text, commentBoxWrapWidth(VP.contentWidth));
  assert.ok(rows.count >= 3, `fixture must soft-wrap, got ${rows.count} rows`);
  let res = view(commentState(text), "\x1b[H"); // home: the last row's first CELL
  assert.equal(res.state.comment?.caret, rows.lastRowStart + 1); // the caret that paints its first cluster, never the bare row start
  res = view(res.state, "\x1b[C"); // right onto the last row proper
  res = view(res.state, "\x1b[F"); // end: past its last character
  assert.equal(res.state.comment?.caret, text.length);
});

test("reduceViewer: up and down move across the soft wrap with goal memory", () => {
  const text = "aaaa bbbb cccc dddd eeee ffff gggg";
  const rows = wrapRows(text, commentBoxWrapWidth(VP.contentWidth));
  assert.ok(rows.count >= 3);
  let res = view(commentState(text), "\x1b[A"); // up from the end (goal col 2): the cluster covering column 2 of the previous row
  assert.equal(res.state.comment?.caret, rows.midRowStart + 3); // its END offset paints that cell
  res = view(res.state, "\x1b[A"); // goal column kept across the wrap
  assert.equal(res.state.comment?.caret, rows.firstRowStart + 3);
  res = view(res.state, "\x1b[B");
  res = view(res.state, "\x1b[B");
  assert.equal(res.state.comment?.caret, text.length);
});

// Row offsets of the fixture above, computed from the same wrap helper the
// reducer uses (rowStarts/rowEnds are exposed for exactly this).
function wrapRows(text: string, width: number) {
  const { rowStarts, rowEnds } = wrapCommentLines(text, width, text.length);
  const last = rowStarts.length - 1;
  return {
    count: rowStarts.length,
    firstRowStart: rowStarts[0],
    midRowStart: rowStarts[last - 1],
    lastRowStart: rowStarts[last],
    lastRowEnd: rowEnds[last],
  };
}

test("reduceViewer: submit after moving the caret annotates the full text", () => {
  let res = view(commentState("note"), "\x1b[D");
  res = view(res.state, "!");
  res = view(res.state, "\r");
  assert.equal(res.effect?.type, "annotate");
  assert.equal(res.effect && res.effect.type === "annotate" ? res.effect.comment : "", "not!e");
});

test("reduceViewer: empty comment submits with empty text", () => {
  const res = view(commentState(""), "\r");
  assert.equal(res.effect?.type, "annotate");
  assert.equal(res.effect && res.effect.type === "annotate" ? res.effect.comment : "", "");
});

test("reduceViewer: Esc in comment mode cancels back to the visual selection", () => {
  const res = view(commentState("draft"), "\x1b");
  assert.equal(res.state.mode, "visual-line");
  assert.deepEqual(res.state.anchor, { line: 2, col: 0 });
  assert.deepEqual(res.state.cursor, { line: 4, col: 3 });
  assert.equal(res.state.comment, null);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: Esc in comment mode restores char-wise when that was the origin", () => {
  const res = view(commentState("draft", "char"), "\x1b");
  assert.equal(res.state.mode, "visual-char");
});

// Edit/delete pending drafts (normal-mode c and x) -------------------------

// Pending drafts ordered oldest first, as store.list() returns them.
const DRAFT_A: PendingDraft = {
  token: "[a.ts:3-5]",
  range: { startLine: 2, startCol: 0, endLine: 4, endCol: 6 },
  comment: "first",
};
const DRAFT_B: PendingDraft = {
  token: "[a.ts:4-4]",
  range: { startLine: 3, startCol: 1, endLine: 3, endCol: 4 },
  comment: "second",
};

test("reduceViewer: c on a pending line enters comment mode editing that draft, pre-filled", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "first", caret: 5 });
  assert.equal(res.state.editingDraftId, DRAFT_A.token);
  assert.equal(res.state.anchor, null);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: c in visual mode starts a fresh comment even on a pending line", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const res = view(start, "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "", caret: 0 });
  assert.equal(res.state.editingDraftId, null);
});

test("reduceViewer: Tab is inert in visual and comment modes", () => {
  const visStart = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  assert.deepEqual(view(visStart, "\t", [DRAFT_A, DRAFT_B]).state, visStart);
  const com = view(commentState("ab"), "\t", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(com.state.comment, { text: "ab", caret: 2 });
});

test("reduceViewer: previewOn survives visual and comment mode round-trips", () => {
  let res = view(viewer({ cursor: { line: 3, col: 0 } }), "p");
  assert.equal(res.state.previewOn, false);
  // Through visual-char: extend the selection, then Esc back to normal.
  res = view({ ...res.state, mode: "visual-char", anchor: { line: 3, col: 0 } }, "j");
  assert.equal(res.state.previewOn, false);
  res = view(res.state, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.previewOn, false);
  // Through the edit flow (c on a pending line, submit updates the draft).
  res = view(res.state, "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  res = view(res.state, "\r", [DRAFT_A]);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.previewOn, false);
});

test("reduceViewer: p in comment mode types into the comment, previewOn untouched", () => {
  const com = view(commentState("x"), "p");
  assert.deepEqual(com.state.comment, { text: "xp", caret: 2 });
  assert.equal(com.effect, undefined);
});
