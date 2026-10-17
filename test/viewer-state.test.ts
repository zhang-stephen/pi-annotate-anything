import { test } from "node:test";
import assert from "node:assert/strict";

import { reduceViewer } from "../src/viewer-state.ts";
import type { PendingDraft, ViewerState } from "../src/viewer-state.ts";

// 30-line fixture: "line 0" .. "line 29" (col max 6 for single-digit lines).
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`);
const VH = 10; // viewport height used across tests

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
    ...overrides,
  };
}

function view(state: ViewerState, key: string, pending: PendingDraft[] = []) {
  return reduceViewer(state, key, LINES, { height: VH }, pending);
}

// Movement: h j k l --------------------------------------------------------

test("reduceViewer: h moves left, l moves right", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "l");
  assert.deepEqual(res.state.cursor, { line: 3, col: 3 });
  const back = view(res.state, "h");
  assert.deepEqual(back.state.cursor, { line: 3, col: 2 });
});

test("reduceViewer: h/l clamp at column bounds without wrapping lines", () => {
  const lines = ["alpha", "hi", "omega"];
  const atEnd = reduceViewer(viewer({ cursor: { line: 0, col: 5 } }), "l", lines, { height: VH });
  assert.deepEqual(atEnd.state.cursor, { line: 0, col: 5 });
  const atStart = reduceViewer(viewer({ cursor: { line: 0, col: 0 } }), "h", lines, { height: VH });
  assert.deepEqual(atStart.state.cursor, { line: 0, col: 0 });
});

test("reduceViewer: j/k move lines and clamp the column to the landed line", () => {
  const lines = ["alpha", "hi", "omega"];
  const down = reduceViewer(viewer({ cursor: { line: 0, col: 5 } }), "j", lines, { height: VH });
  assert.deepEqual(down.state.cursor, { line: 1, col: 2 });
  const down2 = reduceViewer(down.state, "j", lines, { height: VH });
  assert.deepEqual(down2.state.cursor, { line: 2, col: 2 });
  const up = reduceViewer(down2.state, "k", lines, { height: VH });
  assert.deepEqual(up.state.cursor, { line: 1, col: 2 });
});

test("reduceViewer: j/k clamp at file bounds", () => {
  const bottom = view(viewer({ cursor: { line: 29, col: 0 } }), "j");
  assert.deepEqual(bottom.state.cursor, { line: 29, col: 0 });
  const top = view(viewer({ cursor: { line: 0, col: 0 } }), "k");
  assert.deepEqual(top.state.cursor, { line: 0, col: 0 });
});

test("reduceViewer: arrow keys mirror hjkl", () => {
  const start = viewer({ cursor: { line: 3, col: 1 } });
  assert.deepEqual(view(start, "\x1b[A").state.cursor, { line: 2, col: 1 }); // up
  assert.deepEqual(view(start, "\x1b[B").state.cursor, { line: 4, col: 1 }); // down
  assert.deepEqual(view(start, "\x1b[C").state.cursor, { line: 3, col: 2 }); // right
  assert.deepEqual(view(start, "\x1b[D").state.cursor, { line: 3, col: 0 }); // left
});

test("reduceViewer: 0 goes to col 0, $ goes to end of line", () => {
  const home = view(viewer({ cursor: { line: 3, col: 4 } }), "0");
  assert.deepEqual(home.state.cursor, { line: 3, col: 0 });
  const end = view(viewer({ cursor: { line: 3, col: 4 } }), "$");
  assert.deepEqual(end.state.cursor, { line: 3, col: 6 }); // "line 3".length
});

// Two-stroke gg ------------------------------------------------------------

test("reduceViewer: 'g' alone arms the pending stroke without moving", () => {
  const res = view(viewer({ cursor: { line: 15, col: 3 }, scrollTop: 10 }), "g");
  assert.equal(res.effect, undefined);
  assert.equal(res.state.pending, "g");
  assert.deepEqual(res.state.cursor, { line: 15, col: 3 });
});

test("reduceViewer: gg jumps to the first line and scrolls to the top", () => {
  let res = view(viewer({ cursor: { line: 15, col: 3 }, scrollTop: 10 }), "g");
  res = view(res.state, "g");
  assert.equal(res.state.pending, null);
  assert.deepEqual(res.state.cursor, { line: 0, col: 3 });
  assert.equal(res.state.scrollTop, 0);
});

test("reduceViewer: gg in visual mode extends the selection to the file top", () => {
  const base = viewer({
    mode: "visual-char",
    anchor: { line: 8, col: 2 },
    cursor: { line: 10, col: 4 },
  });
  let res = view(base, "g");
  res = view(res.state, "g");
  assert.equal(res.state.mode, "visual-char");
  assert.deepEqual(res.state.anchor, { line: 8, col: 2 });
  assert.deepEqual(res.state.cursor, { line: 0, col: 4 });
});

test("reduceViewer: second non-'g' key after 'g' falls through to normal handling", () => {
  let res = view(viewer({ cursor: { line: 15, col: 3 }, scrollTop: 10 }), "g");
  res = view(res.state, "j");
  assert.equal(res.state.pending, null);
  assert.deepEqual(res.state.cursor, { line: 16, col: 3 });
  assert.equal(res.state.scrollTop, 10); // cursor still inside the viewport
});

test("reduceViewer: 'g' then Esc falls through to normal handling (close)", () => {
  let res = view(viewer({ cursor: { line: 15, col: 3 }, scrollTop: 10 }), "g");
  res = view(res.state, "\x1b");
  assert.deepEqual(res.effect, { type: "close" });
  assert.equal(res.state.pending, null);
});

// G, ctrl+d/ctrl+u, PgUp/PgDn ----------------------------------------------

test("reduceViewer: G jumps to the last line and scrolls to the last page", () => {
  const res = view(viewer({ cursor: { line: 2, col: 3 } }), "G");
  assert.deepEqual(res.state.cursor, { line: 29, col: 3 });
  assert.equal(res.state.scrollTop, 20); // 30 lines, height 10
});

test("reduceViewer: ctrl+d half-page down, ctrl+u half-page up", () => {
  const down = view(viewer({ cursor: { line: 0, col: 0 } }), "\x04");
  assert.deepEqual(down.state.cursor, { line: 5, col: 0 });
  assert.equal(down.state.scrollTop, 0);
  const up = reduceViewer(down.state, "\x15", LINES, { height: VH });
  assert.deepEqual(up.state.cursor, { line: 0, col: 0 });
});

test("reduceViewer: ctrl+d clamps at the file bottom", () => {
  const res = view(viewer({ cursor: { line: 27, col: 0 }, scrollTop: 18 }), "\x04");
  assert.deepEqual(res.state.cursor, { line: 29, col: 0 });
  assert.equal(res.state.scrollTop, 20);
});

test("reduceViewer: ctrl+u clamps at the file top", () => {
  const res = view(viewer({ cursor: { line: 2, col: 0 }, scrollTop: 0 }), "\x15");
  assert.deepEqual(res.state.cursor, { line: 0, col: 0 });
  assert.equal(res.state.scrollTop, 0);
});

test("reduceViewer: PgDn/PgUp scroll a full page", () => {
  const down = view(viewer({ cursor: { line: 0, col: 0 } }), "\x1b[6~");
  assert.deepEqual(down.state.cursor, { line: 10, col: 0 });
  assert.equal(down.state.scrollTop, 1);
  const up = reduceViewer(down.state, "\x1b[5~", LINES, { height: VH });
  assert.deepEqual(up.state.cursor, { line: 0, col: 0 });
  assert.equal(up.state.scrollTop, 0);
});

test("reduceViewer: PgDn clamps at the last page", () => {
  const res = view(viewer({ cursor: { line: 25, col: 0 }, scrollTop: 15 }), "\x1b[6~");
  assert.deepEqual(res.state.cursor, { line: 29, col: 0 });
  assert.equal(res.state.scrollTop, 20);
});

// Viewport scrolling -------------------------------------------------------

test("reduceViewer: j past the viewport bottom scrolls down", () => {
  const res = view(viewer({ cursor: { line: 9, col: 0 }, scrollTop: 0 }), "j");
  assert.deepEqual(res.state.cursor, { line: 10, col: 0 });
  assert.equal(res.state.scrollTop, 1);
});

test("reduceViewer: k above the viewport top scrolls up", () => {
  const res = view(viewer({ cursor: { line: 5, col: 0 }, scrollTop: 5 }), "k");
  assert.deepEqual(res.state.cursor, { line: 4, col: 0 });
  assert.equal(res.state.scrollTop, 4);
});

test("reduceViewer: scrollTop never goes negative", () => {
  const res = view(viewer({ cursor: { line: 0, col: 0 }, scrollTop: 0 }), "k");
  assert.equal(res.state.scrollTop, 0);
});

// Visual modes -------------------------------------------------------------

test("reduceViewer: v enters char-wise visual from normal", () => {
  const res = view(viewer({ cursor: { line: 4, col: 2 } }), "v");
  assert.equal(res.state.mode, "visual-char");
  assert.deepEqual(res.state.anchor, { line: 4, col: 2 });
  assert.equal(res.state.visualMode, "char");
});

test("reduceViewer: v exits char-wise visual back to normal", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 4, col: 2 }, anchor: { line: 4, col: 2 } });
  const res = view(start, "v");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.anchor, null);
});

test("reduceViewer: V enters line-wise visual from normal", () => {
  const res = view(viewer({ cursor: { line: 4, col: 2 } }), "V");
  assert.equal(res.state.mode, "visual-line");
  assert.deepEqual(res.state.anchor, { line: 4, col: 2 });
  assert.equal(res.state.visualMode, "line");
});

test("reduceViewer: V exits line-wise visual back to normal", () => {
  const start = viewer({ mode: "visual-line", cursor: { line: 4, col: 2 }, anchor: { line: 4, col: 2 }, visualMode: "line" });
  const res = view(start, "V");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.anchor, null);
});

test("reduceViewer: v switches line-wise to char-wise keeping the anchor", () => {
  const start = viewer({ mode: "visual-line", cursor: { line: 4, col: 2 }, anchor: { line: 2, col: 1 }, visualMode: "line" });
  const res = view(start, "v");
  assert.equal(res.state.mode, "visual-char");
  assert.deepEqual(res.state.anchor, { line: 2, col: 1 });
  assert.equal(res.state.visualMode, "char");
});

test("reduceViewer: V switches char-wise to line-wise keeping the anchor", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 4, col: 2 }, anchor: { line: 2, col: 1 } });
  const res = view(start, "V");
  assert.equal(res.state.mode, "visual-line");
  assert.deepEqual(res.state.anchor, { line: 2, col: 1 });
  assert.equal(res.state.visualMode, "line");
});

test("reduceViewer: o swaps anchor and cursor in visual mode", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 5, col: 3 }, anchor: { line: 2, col: 1 } });
  const res = view(start, "o");
  assert.equal(res.state.mode, "visual-char");
  assert.deepEqual(res.state.anchor, { line: 5, col: 3 });
  assert.deepEqual(res.state.cursor, { line: 2, col: 1 });
});

test("reduceViewer: o in normal mode is a no-op", () => {
  const start = viewer({ cursor: { line: 5, col: 3 } });
  const res = view(start, "o");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: movement in visual mode moves only the cursor", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 2, col: 1 }, anchor: { line: 2, col: 1 } });
  const res = view(start, "l");
  assert.deepEqual(res.state.cursor, { line: 2, col: 2 });
  assert.deepEqual(res.state.anchor, { line: 2, col: 1 });
});

// Esc / q layering ---------------------------------------------------------

test("reduceViewer: Esc in visual mode exits to normal without an effect", () => {
  const start = viewer({ mode: "visual-line", cursor: { line: 4, col: 2 }, anchor: { line: 2, col: 1 }, visualMode: "line" });
  const res = view(start, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.anchor, null);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: Esc in normal mode requests close", () => {
  const res = view(viewer(), "\x1b");
  assert.deepEqual(res.effect, { type: "close" });
});

test("reduceViewer: q closes only in normal mode", () => {
  const closed = view(viewer(), "q");
  assert.deepEqual(closed.effect, { type: "close" });
  const start = viewer({ mode: "visual-char", cursor: { line: 2, col: 1 }, anchor: { line: 2, col: 1 } });
  const inVisual = view(start, "q");
  assert.equal(inVisual.effect, undefined);
  assert.equal(inVisual.state.mode, "visual-char");
});

test("reduceViewer: unknown keys are no-ops", () => {
  const normal = viewer({ cursor: { line: 5, col: 1 } });
  const inNormal = view(normal, "x");
  assert.deepEqual(inNormal.state, normal);
  assert.equal(inNormal.effect, undefined);
  const visual = viewer({ mode: "visual-char", cursor: { line: 5, col: 1 }, anchor: { line: 5, col: 1 } });
  const inVisual = view(visual, "x");
  assert.deepEqual(inVisual.state, visual);
  assert.equal(inVisual.effect, undefined);
});

// Comment mode -------------------------------------------------------------

test("reduceViewer: c in normal mode does nothing", () => {
  const start = viewer({ cursor: { line: 5, col: 1 } });
  const res = view(start, "c");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

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

test("reduceViewer: unmapped escape sequences are ignored in comment mode", () => {
  const start = commentState("a");
  const res = view(start, "\x1b[A");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: Enter submits the annotation and returns to normal, card open", () => {
  const res = view(commentState("note"), "\r");
  assert.deepEqual(res.effect, {
    type: "annotate",
    range: { startLine: 2, startCol: 0, endLine: 4, endCol: 6 }, // line-wise: endCol = "line 4".length
    mode: "line",
    comment: "note",
  });
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.anchor, null);
  assert.equal(res.state.comment, null);
  assert.equal(res.state.pending, null);
});

test("reduceViewer: char-wise submit carries the normalized range; o-swap invariant", () => {
  const forward = view(viewer({
    mode: "comment",
    cursor: { line: 3, col: 2 },
    anchor: { line: 2, col: 1 },
    visualMode: "char",
    comment: { text: "x" },
  }), "\r");
  assert.deepEqual(forward.effect, {
    type: "annotate",
    range: { startLine: 2, startCol: 1, endLine: 3, endCol: 3 }, // char-wise: cursor col 2 + 1, vim-inclusive
    mode: "char",
    comment: "x",
  });
  const swapped = viewer({
    mode: "comment",
    cursor: { line: 2, col: 1 },
    anchor: { line: 3, col: 2 },
    visualMode: "char",
    comment: { text: "x" },
  });
  const afterSwap = view(swapped, "\r");
  assert.deepEqual(afterSwap.effect, forward.effect);
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

test("reduceViewer: c in normal mode off pending lines is a no-op", () => {
  const start = viewer({ cursor: { line: 10, col: 0 } });
  const res = view(start, "c", [DRAFT_A]);
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: overlapping drafts resolve to the most recently added one", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "c", [DRAFT_A, DRAFT_B]);
  assert.equal(res.state.editingDraftId, DRAFT_B.token);
  assert.deepEqual(res.state.comment, { text: "second" });
});

test("reduceViewer: c in visual mode starts a fresh comment even on a pending line", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const res = view(start, "c", [DRAFT_A]);
  assert.equal(res.state.mode, "comment");
  assert.deepEqual(res.state.comment, { text: "" });
  assert.equal(res.state.editingDraftId, null);
});

test("reduceViewer: submit while editing updates that draft instead of annotating", () => {
  const typed = view(editingState(DRAFT_A, "first"), "!", [DRAFT_A]);
  assert.deepEqual(typed.state.comment, { text: "first!" });
  const res = view(typed.state, "\r", [DRAFT_A]);
  assert.deepEqual(res.effect, { type: "update", draftId: DRAFT_A.token, comment: "first!" });
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.comment, null);
  assert.equal(res.state.editingDraftId, null);
  assert.equal(res.state.anchor, null);
});

test("reduceViewer: Esc while editing cancels back to normal without changes", () => {
  const res = view(editingState(DRAFT_A, "first"), "\x1b", [DRAFT_A]);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.comment, null);
  assert.equal(res.state.editingDraftId, null);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: x on a pending line requests deletion of that draft", () => {
  const start = viewer({ cursor: { line: 3, col: 0 } });
  const res = view(start, "x", [DRAFT_A]);
  assert.deepEqual(res.effect, { type: "delete", draftId: DRAFT_A.token });
  assert.deepEqual(res.state, start);
});

test("reduceViewer: x off pending lines is a no-op", () => {
  const start = viewer({ cursor: { line: 10, col: 0 } });
  const res = view(start, "x", [DRAFT_A]);
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: x in visual mode is a no-op even on a pending line", () => {
  const start = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const res = view(start, "x", [DRAFT_A]);
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

// Purity -------------------------------------------------------------------

test("reduceViewer: does not mutate the input state", () => {
  const start = viewer({ cursor: { line: 5, col: 1 } });
  Object.freeze(start);
  Object.freeze(start.cursor);
  const res = view(start, "j");
  assert.deepEqual(res.state.cursor, { line: 6, col: 1 });
  assert.deepEqual(start.cursor, { line: 5, col: 1 });
  assert.notEqual(res.state, start);
});
