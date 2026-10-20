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

function commentState(text: string, visualMode: "char" | "line" = "line"): ViewerState {
  return viewer({
    mode: "comment",
    cursor: { line: 4, col: 3 },
    anchor: { line: 2, col: 0 },
    visualMode,
    comment: { text },
  });
}

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

function editingState(draft: PendingDraft, text: string): ViewerState {
  return viewer({
    mode: "comment",
    cursor: { line: 3, col: 2 },
    visualMode: "char",
    comment: { text },
    editingDraftId: draft.token,
  });
}

function vpv(contentWidth: number, maxLineWidth: number, height = 5) {
  return { height, contentWidth, maxLineWidth };
}

const LONG_LINE = "x".repeat(100);

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

test("reduceViewer: overlapping drafts resolve to the most recently added one", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "c", [DRAFT_A, DRAFT_B]);
  assert.equal(res.state.editingDraftId, DRAFT_B.token);
  assert.deepEqual(res.state.comment, { text: "second" });
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

test("reduceViewer: a newly added draft snaps the target back to newest", () => {
  // Cycle onto the older draft, then create a third draft over the same
  // spot through the visual annotate flow; afterwards the new draft is the
  // target.
  let res = view(viewer({ cursor: { line: 3, col: 2 } }), "\t", [DRAFT_A, DRAFT_B]);
  assert.equal(res.state.cycleOrdinal, 1);
  res = view(res.state, "v", [DRAFT_A, DRAFT_B]); // mode change resets
  res = view(res.state, "c", [DRAFT_A, DRAFT_B]); // fresh comment on the selection
  res = view(res.state, "!", [DRAFT_A, DRAFT_B]);
  res = view(res.state, "\r", [DRAFT_A, DRAFT_B]);
  assert.equal(res.effect?.type, "annotate");
  const target = view(res.state, "c", [DRAFT_A, DRAFT_B, DRAFT_NEW]);
  assert.equal(target.state.editingDraftId, DRAFT_NEW.token);
});

test("reduceViewer: deleting a middle target keeps the ordinal on the next-older draft", () => {
  const start = viewer({ cursor: { line: 3, col: 2 } });
  const pending = [DRAFT_A, DRAFT_B, DRAFT_C]; // stack [C, B, A]
  const cycled = view(start, "\t", pending);
  assert.equal(cycled.state.cycleOrdinal, 1);
  const del = view(cycled.state, "x", pending);
  assert.deepEqual(del.effect, { type: "delete", draftId: DRAFT_B.token });
  assert.equal(del.state.cycleOrdinal, 1); // A slides into slot 1
  const edit = view(del.state, "c", [DRAFT_A, DRAFT_C]);
  assert.equal(edit.state.editingDraftId, DRAFT_A.token);
});

// Hover preview toggle (normal-mode p) --------------------------------------

test("reduceViewer: p in normal mode toggles previewOn off and back on", () => {
  const start = viewer({ cursor: { line: 3, col: 0 } });
  assert.equal(start.previewOn, true); // session default
  const off = view(start, "p");
  assert.equal(off.state.previewOn, false);
  assert.equal(off.effect, undefined);
  const on = view(off.state, "p");
  assert.equal(on.state.previewOn, true);
  assert.equal(on.effect, undefined);
});

test("reduceViewer: p is a no-op in visual modes", () => {
  const visStart = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const vis = view(visStart, "p");
  assert.deepEqual(vis.state, visStart);
  const vlineStart = viewer({ mode: "visual-line", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const vline = view(vlineStart, "p");
  assert.deepEqual(vline.state, vlineStart);
  assert.equal(vline.effect, undefined);
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

test("reduceViewer: o swap runs cursor follow, pulling the window back to the anchor", () => {
  // Anchor at col 2, cursor pushed right so scrollLeft followed to 81; o
  // swaps the cursor back onto the anchor and the window must follow it.
  const state = viewer({ mode: "visual-char", anchor: { line: 0, col: 2 }, cursor: { line: 0, col: 90 }, scrollLeft: 81 });
  const res = reduceViewer(state, "o", [LONG_LINE], vpv(10, 100));
  assert.equal(res.state.cursor.col, 2);
  assert.equal(res.state.anchor?.col, 90);
  assert.equal(res.state.scrollLeft, 2); // displayCol 2 < 81 -> pinned to it
});

test("message: cleared by the next keypress, re-shown on a repeated identical event", () => {
  const wrapped = view(viewer({ cursor: { line: 29, col: 5 }, lastSearch: "2" }), "n");
  assert.equal(wrapped.state.message, "search hit BOTTOM, continuing at TOP");
  const cleared = view(wrapped.state, "j");
  assert.equal(cleared.state.message ?? null, null);
  const rewrapped = view(wrapped.state, "N"); // wrap the other way from the same spot
  assert.equal(rewrapped.state.message, "search hit TOP, continuing at BOTTOM");
});