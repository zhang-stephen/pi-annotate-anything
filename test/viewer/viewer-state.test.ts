import { test } from "node:test";
import assert from "node:assert/strict";

import { cycleTarget, reduceViewer, stackAtCursor } from "../../src/viewer/viewer-state.ts";
import type { PendingDraft, ViewerState } from "../../src/viewer/viewer-state.ts";

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

test("reduceViewer: h moves left, l moves right", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "l");
  assert.deepEqual(res.state.cursor, { line: 3, col: 3 });
  const back = view(res.state, "h");
  assert.deepEqual(back.state.cursor, { line: 3, col: 2 });
});

test("reduceViewer: h/l clamp at column bounds without wrapping lines", () => {
  const lines = ["alpha", "hi", "omega"];
  const atEnd = reduceViewer(viewer({ cursor: { line: 0, col: 5 } }), "l", lines, VP);
  assert.deepEqual(atEnd.state.cursor, { line: 0, col: 5 });
  const atStart = reduceViewer(viewer({ cursor: { line: 0, col: 0 } }), "h", lines, VP);
  assert.deepEqual(atStart.state.cursor, { line: 0, col: 0 });
});

test("reduceViewer: j/k move lines and clamp the column to the landed line", () => {
  const lines = ["alpha", "hi", "omega"];
  const down = reduceViewer(viewer({ cursor: { line: 0, col: 5 } }), "j", lines, VP);
  assert.deepEqual(down.state.cursor, { line: 1, col: 2 });
  const down2 = reduceViewer(down.state, "j", lines, VP);
  assert.deepEqual(down2.state.cursor, { line: 2, col: 2 });
  const up = reduceViewer(down2.state, "k", lines, VP);
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
  const up = reduceViewer(down.state, "\x15", LINES, VP);
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
  const up = reduceViewer(down.state, "\x1b[5~", LINES, VP);
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

test("reduceViewer: c/x respect draft columns on boundary lines", () => {
  // DRAFT_B covers line 3 cols 1..4 (inclusive of the cursor char): col 0 is
  // before its start, col 5 is past its end - both must miss.
  const beforeStart = view(viewer({ cursor: { line: 3, col: 0 } }), "c", [DRAFT_B]);
  assert.deepEqual(beforeStart.state, viewer({ cursor: { line: 3, col: 0 } }));
  const pastEnd = view(viewer({ cursor: { line: 3, col: 5 } }), "x", [DRAFT_B]);
  assert.deepEqual(pastEnd.state, viewer({ cursor: { line: 3, col: 5 } }));
  const inside = view(viewer({ cursor: { line: 3, col: 4 } }), "c", [DRAFT_B]);
  assert.equal(inside.state.editingDraftId, DRAFT_B.token);
});

// Stack cycling (normal-mode Tab) + target-aware c/x -------------------------

// Pending arrives oldest first, so [A, B, C] stacks at (3,2) as [C, B, A].

test("stackAtCursor: lists covering drafts newest first with draftAtCursor coverage rules", () => {
  assert.deepEqual(
    stackAtCursor(3, 2, [DRAFT_A, DRAFT_B, DRAFT_C]).map((d) => d.token),
    [DRAFT_C.token, DRAFT_B.token, DRAFT_A.token],
  );
  // Column-precise on boundary lines: at col 0 only DRAFT_A covers.
  assert.deepEqual(stackAtCursor(3, 0, [DRAFT_A, DRAFT_B, DRAFT_C]).map((d) => d.token), [DRAFT_A.token]);
  // Whole-line V-mode draft hits anywhere on its line.
  assert.deepEqual(stackAtCursor(5, 3, [DRAFT_V]).map((d) => d.token), [DRAFT_V.token]);
  // Off every range: empty stack.
  assert.deepEqual(stackAtCursor(10, 0, [DRAFT_A, DRAFT_B]), []);
});

test("cycleTarget: resolves stack[ordinal], undefined off any stack", () => {
  const pending = [DRAFT_A, DRAFT_B, DRAFT_C]; // oldest first
  assert.equal(cycleTarget(3, 2, 0, pending)?.token, DRAFT_C.token);
  assert.equal(cycleTarget(3, 2, 1, pending)?.token, DRAFT_B.token);
  assert.equal(cycleTarget(3, 2, 2, pending)?.token, DRAFT_A.token);
  assert.equal(cycleTarget(10, 0, 0, pending), undefined);
});

test("reduceViewer: Tab cycles the target newest-first and wraps around", () => {
  const start = viewer({ cursor: { line: 3, col: 2 } });
  const pending = [DRAFT_A, DRAFT_B, DRAFT_C]; // stack [C, B, A]
  // Each Tab advances one slot older; the edit probe confirms the target.
  const one = view(start, "\t", pending);
  assert.equal(one.state.cycleOrdinal, 1);
  assert.equal(view(one.state, "c", pending).state.editingDraftId, DRAFT_B.token);
  const two = view(one.state, "\t", pending);
  assert.equal(two.state.cycleOrdinal, 2);
  assert.equal(view(two.state, "c", pending).state.editingDraftId, DRAFT_A.token);
  // A third Tab wraps back to the newest.
  const three = view(two.state, "\t", pending);
  assert.equal(three.state.cycleOrdinal, 0);
});

test("reduceViewer: Tab is a no-op on a stack of 1 and off any stack", () => {
  const lone = viewer({ cursor: { line: 3, col: 2 } });
  assert.deepEqual(view(lone, "\t", [DRAFT_A]).state, lone);
  const off = viewer({ cursor: { line: 10, col: 0 } });
  const none = view(off, "\t", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(none.state, off);
  assert.equal(none.effect, undefined);
});

test("reduceViewer: Tab is inert in visual and comment modes", () => {
  const visStart = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  assert.deepEqual(view(visStart, "\t", [DRAFT_A, DRAFT_B]).state, visStart);
  const com = view(commentState("ab"), "\t", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(com.state.comment, { text: "ab" });
});

test("reduceViewer: cursor movement resets the cycle ordinal", () => {
  const start = viewer({ cursor: { line: 3, col: 2 }, cycleOrdinal: 1 });
  assert.equal(view(start, "j").state.cycleOrdinal, 0);
  // Even a column move that stays inside the stack resets.
  const stillOnStack = viewer({ cursor: { line: 3, col: 1 }, cycleOrdinal: 1 });
  assert.equal(view(stillOnStack, "l").state.cycleOrdinal, 0);
  // Two-stroke gg jumps too.
  assert.equal(view(view(start, "g").state, "g").state.cycleOrdinal, 0);
});

test("reduceViewer: mode changes reset the cycle ordinal", () => {
  const start = viewer({ cursor: { line: 3, col: 2 }, cycleOrdinal: 1 });
  assert.equal(view(start, "v").state.cycleOrdinal, 0); // into visual
  const vis = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 2 }, cycleOrdinal: 1 });
  assert.equal(view(vis, "\x1b").state.cycleOrdinal, 0); // Esc back to normal
  // Entering the comment editor via c resets as well.
  assert.equal(view(start, "c", [DRAFT_A, DRAFT_B]).state.cycleOrdinal, 0);
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

test("reduceViewer: x deletes the current cycle target, not the newest", () => {
  // Ordinal 1 of [B, A] is the older draft A.
  const start = viewer({ cursor: { line: 3, col: 2 }, cycleOrdinal: 1 });
  const res = view(start, "x", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(res.effect, { type: "delete", draftId: DRAFT_A.token });
  assert.deepEqual(res.state, { ...start, cycleOrdinal: 0 }); // was the oldest: wrapped
  // Ordinal 0 still targets the newest.
  const newest = view(viewer({ cursor: { line: 3, col: 2 } }), "x", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(newest.effect, { type: "delete", draftId: DRAFT_B.token });
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

test("reduceViewer: deleting the oldest target wraps the ordinal to 0", () => {
  const cycled = view(viewer({ cursor: { line: 3, col: 2 } }), "\t", [DRAFT_A, DRAFT_B]);
  assert.equal(cycled.state.cycleOrdinal, 1); // target A, the oldest
  const del = view(cycled.state, "x", [DRAFT_A, DRAFT_B]);
  assert.deepEqual(del.effect, { type: "delete", draftId: DRAFT_A.token });
  assert.equal(del.state.cycleOrdinal, 0);
  const edit = view(del.state, "c", [DRAFT_B]);
  assert.equal(edit.state.editingDraftId, DRAFT_B.token);
});

test("reduceViewer: deleting the last stacked draft leaves no target", () => {
  const start = viewer({ cursor: { line: 3, col: 2 } });
  const del = view(start, "x", [DRAFT_B]);
  assert.deepEqual(del.effect, { type: "delete", draftId: DRAFT_B.token });
  assert.deepEqual(del.state, start); // lone-draft delete: state untouched
  // Empty stack afterwards: c, x, and Tab are all no-ops.
  const edit = view(del.state, "c", []);
  assert.deepEqual(edit.state, del.state);
  assert.equal(edit.effect, undefined);
  const gone = view(del.state, "x", []);
  assert.deepEqual(gone.state, del.state);
  assert.equal(gone.effect, undefined);
  assert.deepEqual(view(del.state, "\t", []).state, del.state);
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

test("reduceViewer: p is a no-op in visual modes", () => {
  const visStart = viewer({ mode: "visual-char", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const vis = view(visStart, "p");
  assert.deepEqual(vis.state, visStart);
  const vlineStart = viewer({ mode: "visual-line", cursor: { line: 3, col: 2 }, anchor: { line: 3, col: 1 } });
  const vline = view(vlineStart, "p");
  assert.deepEqual(vline.state, vlineStart);
  assert.equal(vline.effect, undefined);
});

test("reduceViewer: p in comment mode types into the comment, previewOn untouched", () => {
  const com = view(commentState("x"), "p");
  assert.deepEqual(com.state.comment, { text: "xp" });
  assert.equal(com.effect, undefined);
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

// Horizontal follow (scrollLeft) -------------------------------------------
// The viewport opts carry contentWidth and maxLineWidth alongside height; the
// reducer keeps the cursor's DISPLAY column (tab-expanded) inside
// [scrollLeft, scrollLeft + contentWidth) with vim sidescrolloff=0 semantics
// and clamps scrollLeft into [0, max(0, maxLineWidth - contentWidth + 1)]
// (the +1 covers the virtual cursor cell of an end-exclusive cursor).

function vpv(contentWidth: number, maxLineWidth: number, height = 5) {
  return { height, contentWidth, maxLineWidth };
}

const LONG_LINE = "x".repeat(100);

test("reduceViewer: l past the window's right edge scrolls horizontally", () => {
  let state = viewer();
  for (let i = 0; i < 10; i++) state = reduceViewer(state, "l", [LONG_LINE], vpv(10, 100)).state;
  assert.deepEqual(state.cursor, { line: 0, col: 10 });
  assert.equal(state.scrollLeft, 1); // follow: 10 >= 0 + 10 -> 10 - 10 + 1
});

test("reduceViewer: h follows the cursor back to the left edge", () => {
  let state = viewer({ cursor: { line: 0, col: 10 }, scrollLeft: 1 });
  for (let i = 0; i < 10; i++) state = reduceViewer(state, "h", [LONG_LINE], vpv(10, 100)).state;
  assert.deepEqual(state.cursor, { line: 0, col: 0 });
  assert.equal(state.scrollLeft, 0);
});

test("reduceViewer: $ on a long line pins scrollLeft at the clamp bound", () => {
  const res = reduceViewer(viewer(), "$", [LONG_LINE], vpv(10, 100));
  assert.deepEqual(res.state.cursor, { line: 0, col: 100 }); // end-exclusive
  // follow target 100 -> 100 - 10 + 1 = 91; clamp max(0, 100 - 10 + 1) = 91.
  assert.equal(res.state.scrollLeft, 91);
});

test("reduceViewer: stale scrollLeft re-clamps on the next reduce", () => {
  // A width change between reduces can leave scrollLeft beyond the bound;
  // any cursor-moving key pulls it back to max(0, 100 - 10 + 1) = 91.
  const dollar = reduceViewer(viewer({ scrollLeft: 500 }), "$", [LONG_LINE], vpv(10, 100));
  assert.equal(dollar.state.scrollLeft, 91);
  const deep = reduceViewer(viewer({ cursor: { line: 0, col: 95 }, scrollLeft: 500 }), "j", [LONG_LINE], vpv(10, 100));
  assert.equal(deep.state.scrollLeft, 91);
});

test("reduceViewer: short lines never scroll", () => {
  let state = viewer();
  for (const key of ["l", "l", "$", "j"]) state = reduceViewer(state, key, ["ab"], vpv(10, 2)).state;
  assert.equal(state.scrollLeft, 0);
});

test("reduceViewer: follow runs in tab-expanded display columns", () => {
  const tabbed = ["\t" + "x".repeat(50)]; // display width 4 + 50 = 54
  const res = reduceViewer(viewer(), "l", tabbed, vpv(4, 54));
  assert.deepEqual(res.state.cursor, { line: 0, col: 1 });
  // display col 4 >= scrollLeft 0 + cw 4 -> scrollLeft 1.
  assert.equal(res.state.scrollLeft, 1);
});

test("reduceViewer: scrollLeft defaults to 0 for states without the field", () => {
  // viewer() constructs no scrollLeft field: the first motion still works
  // and produces a defined, clamped value.
  const res = view(viewer({ cursor: { line: 0, col: 5 } }), "l");
  assert.deepEqual(res.state.cursor, { line: 0, col: 6 });
  assert.equal(res.state.scrollLeft ?? 0, 0);
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

test("reduceViewer: non-motion keys still re-clamp a stale scrollLeft", () => {
  // "p" never reaches keepVisible; the per-reduce clamp must handle it.
  const res = reduceViewer(viewer({ scrollLeft: 500 }), "p", [LONG_LINE], vpv(10, 100));
  assert.equal(res.state.scrollLeft, 91); // max(0, 100 - 10 + 1)
});

// Search mode, count prefix, and transient messages ------------------------
// Matches of "2" in LINES: line 2 col 5, line 12 col 6, lines 20..29 col 5.

test("search: / enters search mode with the cursor as origin and resets count", () => {
  const res = view(viewer({ cursor: { line: 2, col: 3 }, count: 5 }), "/");
  assert.equal(res.state.mode, "search");
  assert.deepEqual(res.state.search, { query: "", origin: { line: 2, col: 3 } });
  assert.equal(res.state.count ?? null, null);
});

test("search: incremental jump per keystroke, forward from origin, no wrap", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "2").state; // "line 2" has "2" at col 5, on the origin line past col 3
  assert.deepEqual(st.cursor, { line: 2, col: 5 });
  assert.deepEqual(st.search?.query, "2");
  st = view(st, "0").state; // "20" first occurs on line 20
  assert.deepEqual(st.cursor, { line: 20, col: 5 });
  st = view(st, "\x7f").state; // back to query "2"
  assert.deepEqual(st.cursor, { line: 2, col: 5 });
});

test("search: no match keeps the cursor at origin", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "z").state;
  assert.deepEqual(st.cursor, { line: 2, col: 3 });
});

test("search: invalid pattern sets the message and keeps the cursor at origin", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "(").state;
  assert.equal(st.mode, "search");
  assert.ok(typeof st.message === "string" && st.message.length > 0);
  assert.deepEqual(st.cursor, { line: 2, col: 3 });
});

test("search: Enter submits, stores lastSearch, keeps the jumped cursor", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "2").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.lastSearch, "2");
  assert.deepEqual(res.state.cursor, { line: 2, col: 5 });
  assert.equal(res.state.search, null);
});

test("search: Enter on an invalid pattern stays in search mode", () => {
  let st = view(viewer(), "/").state;
  st = view(st, "(").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "search");
  assert.ok(typeof res.state.message === "string" && res.state.message.length > 0);
});

test("search: Esc restores the origin cursor and keeps lastSearch", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 }, lastSearch: "9" }), "/").state;
  st = view(st, "2").state; // incremental jump to {2,5}
  const res = view(st, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.deepEqual(res.state.cursor, { line: 2, col: 3 });
  assert.equal(res.state.lastSearch, "9");
});

test("search: empty Enter repeats lastSearch forward like n; without lastSearch it just exits", () => {
  const withLast = view(
    viewer({ mode: "search", cursor: { line: 2, col: 5 }, search: { query: "", origin: { line: 2, col: 5 } }, lastSearch: "2" }),
    "\r",
  );
  assert.equal(withLast.state.mode, "normal");
  assert.deepEqual(withLast.state.cursor, { line: 12, col: 6 });
  const noLast = view(
    viewer({ mode: "search", cursor: { line: 7, col: 1 }, search: { query: "", origin: { line: 7, col: 1 } } }),
    "\r",
  );
  assert.equal(noLast.state.mode, "normal");
  assert.deepEqual(noLast.state.cursor, { line: 7, col: 1 });
});

test("n/N: jump with wrap messages, Pattern not found, inert without lastSearch", () => {
  const fwd = view(viewer({ cursor: { line: 29, col: 5 }, lastSearch: "2" }), "n");
  assert.deepEqual(fwd.state.cursor, { line: 2, col: 5 });
  assert.equal(fwd.state.message, "search hit BOTTOM, continuing at TOP");
  const bwd = view(viewer({ cursor: { line: 2, col: 5 }, lastSearch: "2" }), "N");
  assert.deepEqual(bwd.state.cursor, { line: 29, col: 5 });
  assert.equal(bwd.state.message, "search hit TOP, continuing at BOTTOM");
  const none = view(viewer({ cursor: { line: 0, col: 0 }, lastSearch: "zzz" }), "n");
  assert.equal(none.state.message, "Pattern not found: zzz");
  assert.deepEqual(none.state.cursor, { line: 0, col: 0 });
  const inert = view(viewer({ cursor: { line: 0, col: 0 } }), "n");
  assert.deepEqual(inert.state.cursor, { line: 0, col: 0 });
  assert.equal(inert.state.message ?? null, null);
});

test("message: cleared by the next keypress, re-shown on a repeated identical event", () => {
  const wrapped = view(viewer({ cursor: { line: 29, col: 5 }, lastSearch: "2" }), "n");
  assert.equal(wrapped.state.message, "search hit BOTTOM, continuing at TOP");
  const cleared = view(wrapped.state, "j");
  assert.equal(cleared.state.message ?? null, null);
  const rewrapped = view(wrapped.state, "N"); // wrap the other way from the same spot
  assert.equal(rewrapped.state.message, "search hit TOP, continuing at BOTTOM");
});

test("count: {count}j / {count}G consume the count, digits accumulate", () => {
  assert.deepEqual(view(viewer(), "2").state.count, 2);
  assert.deepEqual(view(view(viewer(), "2").state, "3").state.count, 23);
  assert.deepEqual(view(view(viewer(), "2").state, "j").state.cursor.line, 2);
  assert.deepEqual(view(view(viewer(), "3").state, "G").state.cursor.line, 2);
  assert.deepEqual(view(view(viewer(), "9").state, "9").state.count, 99);
  assert.deepEqual(view(view(view(viewer(), "9").state, "9").state, "G").state.cursor.line, 29); // clamped: 99G -> last line
});

test("count: bare 0 stays the column-0 motion; 0 extends a pending count", () => {
  assert.deepEqual(view(viewer({ cursor: { line: 0, col: 4 } }), "0").state.cursor.col, 0);
  const twenty = view(view(viewer(), "2").state, "0").state;
  assert.equal(twenty.count, 20);
});

test("count: any other key clears it without effect; {count}n repeats the search", () => {
  const visual = view(view(viewer(), "2").state, "v");
  assert.equal(visual.state.mode, "visual-char");
  assert.equal(visual.state.count ?? null, null);
  const jump = view(view(viewer({ cursor: { line: 2, col: 5 }, lastSearch: "2" }), "2").state, "n");
  assert.deepEqual(jump.state.cursor, { line: 20, col: 5 });
  assert.equal(jump.state.count ?? null, null);
});

test("search: Enter on a zero-match pattern stores lastSearch, stays at origin, and reports", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "z").state;
  st = view(st, "z").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.lastSearch, "zz");
  assert.deepEqual(res.state.cursor, { line: 2, col: 3 });
  assert.equal(res.state.message, "Pattern not found: zz");
});
