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

// Goal-column memory (curswant) ---------------------------------------------

// Two long rails (20 cols) around short lines: a goal column of 10 must
// survive the short hops and come back on the next rail. contentWidth 30
// exceeds every line, so no horizontal follow interferes.
const RAILS = ["x".repeat(20), "ab", "x".repeat(20), "cd", "x".repeat(20)];

function viewOn(lines: string[], state: ViewerState, key: string) {
  return reduceViewer(state, key, lines, vpv(30, 20));
}

test("curswant: j over a short line restores the original column on the way back", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  assert.deepEqual(down.state.cursor, { line: 1, col: 2 }); // clamped on "ab"
  assert.equal(down.state.wantedCol, 10); // the goal survives the clamp
  const back = viewOn(RAILS, down.state, "j");
  assert.deepEqual(back.state.cursor, { line: 2, col: 10 }); // restored
});

test("curswant: k mirrors the goal-column restore across a short line", () => {
  const up = viewOn(RAILS, viewer({ cursor: { line: 2, col: 10 } }), "k");
  assert.deepEqual(up.state.cursor, { line: 1, col: 2 });
  const back = viewOn(RAILS, up.state, "k");
  assert.deepEqual(back.state.cursor, { line: 0, col: 10 });
});

test("curswant: repeated j through a field of short lines keeps the goal column", () => {
  const field = ["x".repeat(20), "a", "b", "c", "x".repeat(20)];
  let state = viewer({ cursor: { line: 0, col: 10 } });
  for (const line of [1, 2, 3]) {
    state = viewOn(field, state, "j").state;
    assert.deepEqual(state.cursor, { line, col: 1 }); // clamped, goal kept
  }
  const back = viewOn(field, state, "j");
  assert.deepEqual(back.state.cursor, { line: 4, col: 10 }); // goal restored
});

test("curswant: h resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  const left = viewOn(RAILS, down.state, "h");
  assert.equal(left.state.wantedCol, null);
  const next = viewOn(RAILS, left.state, "j"); // aims at the clamped col, not the stale goal
  assert.deepEqual(next.state.cursor, { line: 2, col: 1 });
});

test("curswant: l resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  const right = viewOn(RAILS, down.state, "l"); // parked at "ab" end, col stays 2
  assert.equal(right.state.wantedCol, null);
  const next = viewOn(RAILS, right.state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 2 }); // not 10
});

test("curswant: gg resets the goal column", () => {
  const up = viewOn(RAILS, viewer({ cursor: { line: 4, col: 10 } }), "k");
  assert.equal(up.state.wantedCol, 10);
  const home = viewOn(RAILS, viewOn(RAILS, up.state, "g").state, "g");
  assert.deepEqual(home.state.cursor, { line: 0, col: 2 }); // gg keeps the clamped col
  assert.equal(home.state.wantedCol, null);
  const next = viewOn(RAILS, viewOn(RAILS, home.state, "j").state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 2 }); // fresh goal 2, not 10
});

test("curswant: G resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  const last = viewOn(RAILS, down.state, "G");
  assert.deepEqual(last.state.cursor, { line: 4, col: 2 }); // G keeps the clamped col
  assert.equal(last.state.wantedCol, null);
  const next = viewOn(RAILS, viewOn(RAILS, last.state, "k").state, "k");
  assert.deepEqual(next.state.cursor, { line: 2, col: 2 }); // fresh goal 2, not 10
});

test("curswant: an n jump resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 }, lastSearch: "x" }), "j");
  assert.equal(down.state.wantedCol, 10);
  const jump = viewOn(RAILS, down.state, "n"); // next "x" match at/after (1,2) is (2,0)
  assert.deepEqual(jump.state.cursor, { line: 2, col: 0 });
  assert.equal(jump.state.wantedCol, null);
  const next = viewOn(RAILS, jump.state, "k");
  assert.deepEqual(next.state.cursor, { line: 1, col: 0 }); // fresh goal 0, not 10
});

test("curswant: a mode transition resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  const visual = viewOn(RAILS, down.state, "v"); // normal -> visual resets
  assert.equal(visual.state.wantedCol, null);
  const back = viewOn(RAILS, visual.state, "\x1b"); // Esc to normal stays none
  assert.equal(back.state.wantedCol, null);
  const next = viewOn(RAILS, back.state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 2 }); // aims at clamped col, not 10
});

test("curswant: visual-mode j/k preserve the goal column too", () => {
  let res = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "v");
  assert.equal(res.state.mode, "visual-char");
  res = viewOn(RAILS, res.state, "j");
  assert.deepEqual(res.state.cursor, { line: 1, col: 2 }); // clamped
  res = viewOn(RAILS, res.state, "j");
  assert.deepEqual(res.state.cursor, { line: 2, col: 10 }); // goal restored in visual
  assert.deepEqual(res.state.anchor, { line: 0, col: 10 }); // anchor never moved
});

test("curswant: Down (\\x1b[B) preserves the goal column like j", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "\x1b[B");
  assert.deepEqual(down.state.cursor, { line: 1, col: 2 });
  const next = viewOn(RAILS, down.state, "\x1b[B");
  assert.deepEqual(next.state.cursor, { line: 2, col: 10 });
});

test("curswant: Up (\\x1b[A) preserves the goal column like k", () => {
  const up = viewOn(RAILS, viewer({ cursor: { line: 2, col: 10 } }), "\x1b[A");
  assert.deepEqual(up.state.cursor, { line: 1, col: 2 });
  const next = viewOn(RAILS, up.state, "\x1b[A");
  assert.deepEqual(next.state.cursor, { line: 0, col: 10 });
});

test("curswant: Left (\\x1b[D) resets the goal column like h", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "\x1b[B");
  const left = viewOn(RAILS, down.state, "\x1b[D");
  assert.equal(left.state.wantedCol, null);
  const next = viewOn(RAILS, left.state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 1 });
});

test("curswant: Right (\\x1b[C) resets the goal column like l", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "\x1b[B");
  const right = viewOn(RAILS, down.state, "\x1b[C"); // parked at "ab" end
  assert.equal(right.state.wantedCol, null);
  const next = viewOn(RAILS, right.state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 2 });
});
test("curswant: 0 and $ reset the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  const zero = viewOn(RAILS, down.state, "0");
  assert.equal(zero.state.wantedCol, null);
  const next = viewOn(RAILS, zero.state, "j");
  assert.deepEqual(next.state.cursor, { line: 2, col: 0 }); // fresh goal 0, not 10
  const dollar = viewOn(RAILS, down.state, "$"); // "ab" end, col 2
  assert.equal(dollar.state.wantedCol, null);
  const after = viewOn(RAILS, dollar.state, "j");
  assert.deepEqual(after.state.cursor, { line: 2, col: 2 }); // fresh goal 2, not 10
});

test("curswant: ctrl+d/ctrl+u and PgDn/PgUp keep the goal column", () => {
  // Rails every few lines so half-page (2 of vh 5) and full-page (5) jumps
  // land on long lines and the aimed column shows.
  const R = "x".repeat(20);
  const tall = [R, "a", "ab", R, "ab", "ab", "ab", "ab", R];
  const down = viewOn(tall, viewer({ cursor: { line: 0, col: 10 } }), "j"); // clamps to col 1 on "a", goal 10 kept
  const half = viewOn(tall, down.state, "\x04"); // ctrl+d: line 1+2 lands on the rail
  assert.deepEqual(half.state.cursor, { line: 3, col: 10 }); // aimed at the goal
  assert.equal(half.state.wantedCol, 10);
  const dn = viewOn(tall, half.state, "\x1b[6~"); // PgDn: 3+5 lands on the last rail
  assert.deepEqual(dn.state.cursor, { line: 8, col: 10 });
  const full = viewOn(tall, dn.state, "\x1b[5~"); // PgUp: 8-5 back to the rail
  assert.deepEqual(full.state.cursor, { line: 3, col: 10 });
  const up = viewOn(tall, full.state, "\x15"); // ctrl+u: 3-2 clamps onto "a"
  assert.deepEqual(up.state.cursor, { line: 1, col: 1 }); // clamp holds, goal kept
  assert.equal(up.state.wantedCol, 10);
});

// Command mode (:) -----------------------------------------------------------

test("command: : enters command mode and drops any pending count", () => {
  const res = view(viewer({ cursor: { line: 2, col: 3 }, count: 5 }), ":");
  assert.equal(res.state.mode, "command");
  assert.deepEqual(res.state.command, { value: "" });
  assert.equal(res.state.count ?? null, null);
  assert.equal(res.effect, undefined);
});

test("command: : is inert in visual, comment, and search modes", () => {
  const char = view(viewer({ mode: "visual-char", cursor: { line: 2, col: 3 }, anchor: { line: 2, col: 3 } }), ":");
  assert.equal(char.state.mode, "visual-char");
  assert.equal(char.state.command ?? null, null);
  assert.equal(char.effect, undefined);
  const line = view(
    viewer({ mode: "visual-line", cursor: { line: 2, col: 3 }, anchor: { line: 2, col: 3 }, visualMode: "line" }),
    ":",
  );
  assert.equal(line.state.mode, "visual-line");
  assert.equal(line.state.command ?? null, null);
  // Comment and search inputs keep receiving the keystroke; command mode is
  // not entered from either.
  const comment = view(commentState(""), ":");
  assert.equal(comment.state.mode, "comment");
  assert.deepEqual(comment.state.comment, { text: ":" });
  const search = view(
    viewer({ mode: "search", cursor: { line: 2, col: 3 }, search: { query: "", origin: { line: 2, col: 3 } } }),
    ":",
  );
  assert.equal(search.state.mode, "search");
  assert.deepEqual(search.state.search, { query: ":", origin: { line: 2, col: 3 } });
});

test("command: typing appends whole and Backspace pops; at empty it exits", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  assert.deepEqual(st.command, { value: "q" });
  st = view(st, "noh").state; // multi-char chunks (pastes) append whole
  assert.deepEqual(st.command, { value: "qnoh" });
  st = view(st, "\x7f").state;
  st = view(st, "\x7f").state;
  st = view(st, "\x7f").state;
  assert.deepEqual(st.command, { value: "q" });
  st = view(st, "\x7f").state;
  st = view(st, "\x7f").state; // popping at the empty value exits to normal (E2E amendment)
  assert.equal(st.mode, "normal");
  assert.equal(st.command, null);
});

test("command: Esc returns to normal with the line cleared and no effect", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  const res = view(st, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.command, null);
  assert.equal(res.effect, undefined);
});

test("command: Enter on :q closes the card in normal mode", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.command, null);
  assert.deepEqual(res.effect, { type: "close" });
});

test("command: Enter on :zzz reports E492 and returns to normal", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "zzz").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.message, "E492: Not an editor command: zzz");
  assert.equal(res.effect, undefined);
});

test("command: :noh darkens the highlight and the next n re-lights it", () => {
  // A completed search first: /2 jumps to the "2" on line 2, storing lastSearch.
  let st = view(viewer(), "/").state;
  st = view(st, "2").state;
  st = view(st, "\r").state;
  assert.deepEqual(st.cursor, { line: 2, col: 5 });
  let res = view(st, ":");
  res = view(res.state, "noh"); // the whole word lands as one append
  res = view(res.state, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.searchHL, false); // nohlsearch ran
  const next = view(res.state, "n");
  assert.equal(next.state.searchHL, true); // explicitly re-lit by the search command
  assert.deepEqual(next.state.cursor, { line: 12, col: 6 }); // and the search repeated
});

test("command: Enter on the empty line returns to normal silently", () => {
  const res = view(view(viewer(), ":").state, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.command, null); // the line draft is dropped, not kept
  assert.equal(res.state.message ?? null, null);
  assert.equal(res.effect, undefined);
});

test("command: newline-shaped and control keys are ignored while editing", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  for (const key of ["\n", "\x1b\r", "\t", "\x01"]) {
    const res = view(st, key);
    assert.equal(res.state.mode, "command");
    assert.deepEqual(res.state.command, { value: "q" });
    assert.equal(res.effect, undefined);
  }
});

test("command: : entry resets the goal column", () => {
  const down = viewOn(RAILS, viewer({ cursor: { line: 0, col: 10 } }), "j");
  assert.equal(down.state.wantedCol, 10);
  const cmd = viewOn(RAILS, down.state, ":");
  assert.equal(cmd.state.wantedCol ?? null, null);
});

test("command mode: after :7 executes, a fresh : starts a clean input", () => {
  // E2E regression: the address path used to leave mode "command" behind,
  // so the next ":" was appended as input content ("::") and failed as E492.
  let st = viewer({ cursor: { line: 0, col: 0 } });
  st = reduceViewer(st, ":", RAILS, vpv(30, 20)).state;
  st = reduceViewer(st, "7", RAILS, vpv(30, 20)).state;
  st = reduceViewer(st, "\r", RAILS, vpv(30, 20)).state;
  assert.equal(st.mode, "normal");
  assert.equal(st.command, null);
  assert.equal(st.cursor.line, 4); // RAILS has 5 lines; 7 clamps to the last
  st = reduceViewer(st, ":", RAILS, vpv(30, 20)).state;
  assert.equal(st.mode, "command");
  assert.deepEqual(st.command, { value: "" });
});

test("command mode: backspace at the empty value exits to normal mode like Esc", () => {
  let st = viewer({ cursor: { line: 0, col: 0 } });
  st = reduceViewer(st, ":", RAILS, vpv(30, 20)).state;
  st = reduceViewer(st, "\x7f", RAILS, vpv(30, 20)).state;
  assert.equal(st.mode, "normal");
  assert.equal(st.command, null);
});
