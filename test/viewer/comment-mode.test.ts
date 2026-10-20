import { test } from "node:test";
import assert from "node:assert/strict";

import { reduceViewer } from "../../src/viewer/state.ts";
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

// Movement: h j k l --------------------------------------------------------

test("reduceViewer: c with an active selection enters comment mode", () => {
  const start = viewer({ mode: "visual-line", cursor: { line: 4, col: 3 }, anchor: { line: 2, col: 0 }, visualMode: "line" });
  const res = view(start, "c");
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "" });
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
    comment: { text },
  });
}

test("reduceViewer: printable keys append in comment mode; cursor untouched", () => {
  let res = view(commentState(""), "h");
  assert.deepEqual(res.state.comment, { text: "h" });
  res = view(res.state, "i");
  assert.deepEqual(res.state.comment, { text: "hi" });
  assert.deepEqual(res.state.cursor, { line: 4, col: 3 });
});

test("reduceViewer: ctrl+j inserts a newline in comment mode", () => {
  const res = view(commentState("a"), "\n");
  assert.deepEqual(res.state.comment, { text: "a\n" });
});

test("reduceViewer: shift+enter inserts a newline in comment mode", () => {
  const res = view(commentState("ab"), "\x1b\r");
  assert.deepEqual(res.state.comment, { text: "ab\n" });
});

test("reduceViewer: backspace deletes the last comment char", () => {
  const res = view(commentState("ab"), "\x7f");
  assert.deepEqual(res.state.comment, { text: "a" });
  const empty = view(commentState(""), "\x7f");
  assert.deepEqual(empty.state.comment, { text: "" });
});

test("reduceViewer: q types 'q' in comment mode", () => {
  const res = view(commentState(""), "q");
  assert.deepEqual(res.state.comment, { text: "q" });
  assert.equal(res.effect, undefined);
});

test("reduceViewer: multi-char paste chunk is appended whole in comment mode", () => {
  const res = view(commentState(""), "hello world");
  assert.deepEqual(res.state.comment, { text: "hello world" });
});

test("reduceViewer: astral-plane chars append in comment mode", () => {
  const res = view(commentState(""), "\u{10348}");
  assert.deepEqual(res.state.comment, { text: "\u{10348}" });
});

test("reduceViewer: chunks with Esc or C0 controls are ignored in comment mode", () => {
  const start = commentState("a");
  for (const key of ["\x1b[200~", "pasted \x1b[B", "\x01"]) {
    const res = view(start, key);
    assert.deepEqual(res.state.comment, { text: "a" });
    assert.equal(res.effect, undefined);
  }
});

test("reduceViewer: tab characters are rejected in comment mode", () => {
  // The box renderer never expands tabs, so \t would misalign the wrap and
  // cursor column math; whole chunks containing one are ignored.
  const start = commentState("a");
  for (const key of ["\t", "x\ty"]) {
    const res = view(start, key);
    assert.deepEqual(res.state.comment, { text: "a" });
    assert.equal(res.effect, undefined);
  }
});

test("reduceViewer: unmapped escape sequences are ignored in comment mode", () => {
  const start = commentState("a");
  const res = view(start, "\x1b[A");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
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
// Third draft stacked on (3,2), for three-deep cycling tests.
const DRAFT_C: PendingDraft = {
  token: "[a.ts:4-4]#2",
  range: { startLine: 3, startCol: 2, endLine: 3, endCol: 2 },
  comment: "third",
};
// A draft created after A/B/C, landing on (3,2) as the new newest.
const DRAFT_NEW: PendingDraft = {
  token: "[a.ts:4-4]#3",
  range: { startLine: 3, startCol: 2, endLine: 3, endCol: 5 },
  comment: "newest",
};
// Whole-line (V-mode) draft over line 5: startCol 0 / endCol = line length
// ("line 5".length = 6), so it hits anywhere on the line.
const DRAFT_V: PendingDraft = {
  token: "[a.ts:6-6]",
  range: { startLine: 5, startCol: 0, endLine: 5, endCol: 6 },
  comment: "vline",
};

function editingState(draft: PendingDraft, text: string): ViewerState {
  return viewer({
    mode: "comment",
    cursor: { line: 3, col: 2 },
    visualMode: "char",
    comment: { text },
    editingDraftId: draft.token,
  });
}

test("reduceViewer: c on a pending line enters comment mode editing that draft, pre-filled", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "first" });
  assert.equal(res.state.editingDraftId, DRAFT_A.token);
  assert.equal(res.state.anchor, null);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: c in visual mode starts a fresh comment even on a pending line", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const res = view(start, "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "" });
  assert.equal(res.state.editingDraftId, null);
});

test("reduceViewer: Tab is inert in visual and comment modes", () => {
  const visStart = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  assert.deepEqual(view(visStart, "\t", [DRAFT_A, DRAFT_B]).state, visStart);
  const com = view(commentState("ab"), "\t", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(com.state.comment, { text: "ab" });
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
  assert.deepEqual(com.state.comment, { text: "xp" });
  assert.equal(com.effect, undefined);
});