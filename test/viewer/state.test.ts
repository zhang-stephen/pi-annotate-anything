import { test } from "node:test";
import assert from "node:assert/strict";

import { reduceViewer } from "../../src/viewer/state.ts";
import type { PendingDraft, ViewerState, ViewerViewport } from "../../src/viewer/state.ts";
import { COMMANDS } from "../../src/viewer/commands.ts";
import type { CommandSpec } from "../../src/viewer/commands.ts";
import { buildDisplayLine } from "../../src/tui/display.ts";
import { buildVisualLayout } from "../../src/viewer/wrap.ts";
import type { VisualLayout } from "../../src/viewer/wrap.ts";

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
    comment: { text, caret: text.length },
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
    comment: { text, caret: text.length },
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

// 2.0 amendment: the normal-mode q and Esc close mappings are gone; ":q" is
// the only close, pinned below by "command: Enter on :q closes the card in
// normal mode" and by executeCommand's quit test in commands.test.ts.

test("reduceViewer: Esc in normal mode is an explicit no-op", () => {
  const start = viewer({ cursor: { line: 5, col: 3 } });
  const res = view(start, "\x1b");
  assert.deepEqual(res.state, start);
  assert.equal(res.effect, undefined);
});

test("reduceViewer: q is unmapped in normal and visual modes", () => {
  const start = viewer({ cursor: { line: 5, col: 3 } });
  const inNormal = view(start, "q");
  assert.deepEqual(inNormal.state, start);
  assert.equal(inNormal.effect, undefined);
  const visual = viewer({ mode: "visual-char", cursor: { line: 2, col: 1 }, anchor: { line: 2, col: 1 } });
  const inVisual = view(visual, "q");
  assert.deepEqual(inVisual.state, visual);
  assert.equal(inVisual.effect, undefined);
});

test("reduceViewer: :q still closes through the ex layer", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.deepEqual(res.effect, { type: "close" });
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
    comment: { text: "x", caret: 1 },
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
    comment: { text: "x", caret: 1 },
  });
  const afterSwap = view(swapped, "\r");
  assert.deepEqual(afterSwap.effect, forward.effect);
});

test("reduceViewer: overlapping drafts resolve to the most recently added one", () => {
  const res = view(viewer({ cursor: { line: 3, col: 2 } }), "c", [DRAFT_A, DRAFT_B]);
  assert.equal(res.state.editingDraftId, DRAFT_B.token);
  assert.deepEqual(res.state.comment, { text: "second", caret: 6 });
});

test("reduceViewer: submit while editing updates that draft instead of annotating", () => {
  const typed = view(editingState(DRAFT_A, "first"), "!", [DRAFT_A]);
  assert.deepEqual(typed.state.comment, { text: "first!", caret: 6 });
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
  assert.deepEqual(comment.state.comment, { text: ":", caret: 1 });
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
  // Tab is no longer inert: it drives completion cycling (tests below).
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  for (const key of ["\n", "\x1b\r", "\x01"]) {
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

// Command-name completion (Tab cycling) ----------------------------------------
//
// Tab is completion's only special key: the first press snapshots the live
// candidates of the current value (the anchor) and accepts the first;
// further presses advance the snapshot, wrapping; every other key drops
// back to live mode. Enter/Esc keep their exact pre-completion behavior.

// A crafted second "noh..." entry so a multi-candidate anchor exists (the
// shipped table's names share no prefix); pushed per test, popped in
// finally, mirroring the ambiguity fixture in commands.test.ts.
function craftedCommand(name: string): CommandSpec {
  return { name, short: name, desc: "extra", args: "none", run: (state) => ({ state }) };
}

test("command: Tab accepts the first candidate into the value", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "n").state;
  st = view(st, "\t").state;
  assert.deepEqual(st.command, { value: "nohlsearch", completion: { anchor: "n", index: 0 } });
});

test("command: repeated Tabs cycle the snapshot and wrap around", () => {
  COMMANDS.push(craftedCommand("nohextra"));
  try {
    let st = view(viewer(), ":").state;
    st = view(st, "n").state;
    st = view(st, "\t").state;
    st = view(st, "\t").state; // advance to the crafted entry
    assert.deepEqual(st.command, { value: "nohextra", completion: { anchor: "n", index: 1 } });
    st = view(st, "\t").state; // wrap to the first candidate again
    assert.deepEqual(st.command, { value: "nohlsearch", completion: { anchor: "n", index: 0 } });
    assert.equal(st.command?.completion?.anchor, "n"); // anchor frozen throughout
  } finally {
    COMMANDS.pop();
  }
});

test("command: the completion anchor freezes while the value changes", () => {
  // After the first Tab the value holds the accepted name; the snapshot
  // must stay the candidates of the ORIGINAL value ("n" matches both
  // entries with the crafted one, the accepted name only itself), so the
  // next Tab still reaches the second candidate.
  COMMANDS.push(craftedCommand("nohextra"));
  try {
    let st = view(viewer(), ":").state;
    st = view(st, "n").state;
    st = view(st, "\t").state;
    st = view(st, "\t").state;
    assert.equal(st.command?.completion?.anchor, "n");
    assert.equal(st.command?.value, "nohextra");
  } finally {
    COMMANDS.pop();
  }
});

test("command: typing clears the completion but keeps the accepted value", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  st = view(st, "\t").state; // accept "quit"
  assert.deepEqual(st.command, { value: "quit", completion: { anchor: "q", index: 0 } });
  st = view(st, "x").state; // live mode again: the draft drops the cycling state
  assert.deepEqual(st.command, { value: "quitx" });
  assert.equal(st.mode, "command");
});

test("command: Backspace clears the completion and pops the accepted value", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  st = view(st, "\t").state;
  st = view(st, "\x7f").state;
  assert.deepEqual(st.command, { value: "qui" });
});

test("command: an ignored control key clears the completion and keeps the value", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  st = view(st, "\t").state;
  st = view(st, "\x01").state;
  assert.equal(st.mode, "command");
  assert.deepEqual(st.command, { value: "quit" });
});

test("command: Tab with no candidates is a no-op", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "z").state;
  st = view(st, "\t").state;
  assert.deepEqual(st.command, { value: "z" });
  st = view(st, "\t").state; // still no candidates: still a no-op
  assert.deepEqual(st.command, { value: "z" });
  // Bare ":" has an empty value and no candidates either.
  const empty = view(view(viewer(), ":").state, "\t").state;
  assert.deepEqual(empty.command, { value: "" });
});

test("command: Enter executes the accepted value with the completion active", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  st = view(st, "\t").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.deepEqual(res.effect, { type: "close" }); // quit ran
  assert.equal(res.state.command, null);
});

test("command: Esc exits command mode with the completion active", () => {
  let st = view(viewer(), ":").state;
  st = view(st, "q").state;
  st = view(st, "\t").state;
  const res = view(st, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.command, null);
  assert.equal(res.effect, undefined);
});

// zw / zr display-mode toggles (real Task 5 layouts) ------------------------
// zw flips soft wrap and zr flips markdown render; both preserve the raw
// cursor and anchor, remap scrollTop between the logical and visual
// coordinate spaces keeping the cursor's viewport offset, reset wantedCol
// and scrollLeft, and re-run keepVisible in the new space.

const TOGGLE_LINES = Array.from({ length: 6 }, () => "aaa bbb ccc"); // 12 visual rows at width 8
const TOGGLE_LAYOUT = buildVisualLayout(TOGGLE_LINES, TOGGLE_LINES.map((l) => buildDisplayLine(l)), 8);

// Markdown-ish pair for zr: the current layout carries "> " prefixes, the
// alternate (render off) drops them, so line 1 starts at visual row 2 in
// current space and row 1 in alternate space. Four lines keep both layouts
// taller than the viewport so scrollTop clamping cannot mask the remap.
const ZR_LINES = ["aaa bbb", "ccc ddd", "eee fff", "ggg hhh"];
const ZR_CURRENT = buildVisualLayout(ZR_LINES, ZR_LINES.map((l) => buildDisplayLine(l, { prefix: "> " })), 8); // 8 rows
const ZR_ALTERNATE = buildVisualLayout(ZR_LINES, ZR_LINES.map((l) => buildDisplayLine(l)), 8); // 4 rows

const WRAP_LINES = ["aaa bbb ccc", "hi", "ddd eee fff"]; // 5 visual rows at width 8
const WRAP_LAYOUT = buildVisualLayout(WRAP_LINES, WRAP_LINES.map((l) => buildDisplayLine(l)), 8);

function zrVp(current: VisualLayout, alternate: VisualLayout, canToggleRender: boolean, height = 3): ViewerViewport {
  return {
    height,
    contentWidth: 8,
    maxLineWidth: Math.max(current.maxLineWidth, alternate.maxLineWidth),
    display: { current, alternate, canToggleRender },
  };
}

test("wrap toggle: z arms a pending stroke without moving", () => {
  const res = view(viewer(), "z");
  assert.equal(res.state.pending, "z");
  assert.deepEqual(res.state.cursor, { line: 0, col: 0 });
});

test("wrap toggle: zw flips wrapOn preserving raw cursor and viewport offset", () => {
  const vp = { height: 5, contentWidth: 8, maxLineWidth: TOGGLE_LAYOUT.maxLineWidth, display: { current: TOGGLE_LAYOUT, alternate: TOGGLE_LAYOUT, canToggleRender: false } };
  // Cursor (4,3) sits on visual row 8; scrollTop 4 keeps it at viewport
  // offset 4. The flip must keep that offset in logical lines: 4 - 4 = 0.
  const st = viewer({ cursor: { line: 4, col: 3 }, scrollTop: 4, wantedCol: 7, scrollLeft: 2 });
  let state = reduceViewer(st, "z", TOGGLE_LINES, vp).state;
  assert.equal(state.pending, "z");
  assert.deepEqual(state.cursor, { line: 4, col: 3 });
  state = reduceViewer(state, "w", TOGGLE_LINES, vp).state;
  assert.equal(state.wrapOn, false);
  assert.equal(state.pending, null);
  assert.deepEqual(state.cursor, { line: 4, col: 3 }); // raw cursor preserved
  assert.equal(state.scrollTop, 0);
  assert.equal(state.wantedCol, null); // goal session ended with the space
  assert.equal(state.scrollLeft, 0); // reset: no horizontal follow after toggles
});

test("wrap toggle: zw from nowrap remaps scrollTop into visual rows", () => {
  const vp = { height: 5, contentWidth: 8, maxLineWidth: TOGGLE_LAYOUT.maxLineWidth, display: { current: TOGGLE_LAYOUT, alternate: TOGGLE_LAYOUT, canToggleRender: false } };
  // Logical offset: cursor line 4 - scrollTop 2 = 2. After the flip the
  // cursor's first visual row is 8, so scrollTop becomes 8 - 2 = 6.
  let state = viewer({ cursor: { line: 4, col: 3 }, scrollTop: 2, wrapOn: false });
  state = reduceViewer(state, "z", TOGGLE_LINES, vp).state;
  state = reduceViewer(state, "w", TOGGLE_LINES, vp).state;
  assert.equal(state.wrapOn, true);
  assert.deepEqual(state.cursor, { line: 4, col: 3 });
  assert.equal(state.scrollTop, 6);
  assert.equal(state.wantedCol, null);
  assert.equal(state.scrollLeft, 0);
});

test("wrap toggle: zw twice round-trips scrollTop through both spaces", () => {
  const vp = { height: 5, contentWidth: 8, maxLineWidth: TOGGLE_LAYOUT.maxLineWidth, display: { current: TOGGLE_LAYOUT, alternate: TOGGLE_LAYOUT, canToggleRender: false } };
  let state = viewer({ cursor: { line: 4, col: 3 }, scrollTop: 4 });
  state = reduceViewer(state, "z", TOGGLE_LINES, vp).state;
  state = reduceViewer(state, "w", TOGGLE_LINES, vp).state; // -> logical: scrollTop 0
  state = reduceViewer(state, "z", TOGGLE_LINES, vp).state;
  state = reduceViewer(state, "w", TOGGLE_LINES, vp).state; // -> visual: 8 - 4
  assert.equal(state.wrapOn, true);
  assert.equal(state.scrollTop, 4);
});

test("wrap toggle: zw in visual mode preserves the raw anchor", () => {
  const vp = { height: 5, contentWidth: 8, maxLineWidth: TOGGLE_LAYOUT.maxLineWidth, display: { current: TOGGLE_LAYOUT, alternate: TOGGLE_LAYOUT, canToggleRender: false } };
  let state = viewer({ mode: "visual-char", visualMode: "char", cursor: { line: 4, col: 3 }, anchor: { line: 4, col: 3 }, scrollTop: 5 });
  state = reduceViewer(state, "j", TOGGLE_LINES, vp).state; // row 9 -> raw (4,11)
  assert.deepEqual(state.cursor, { line: 4, col: 11 });
  state = reduceViewer(state, "z", TOGGLE_LINES, vp).state;
  state = reduceViewer(state, "w", TOGGLE_LINES, vp).state;
  assert.equal(state.wrapOn, false);
  assert.deepEqual(state.cursor, { line: 4, col: 11 }); // raw cursor preserved
  assert.deepEqual(state.anchor, { line: 4, col: 3 }); // raw anchor preserved
  // Offset 4 (row 9 - scrollTop 5): line 4 - 4 = 0.
  assert.equal(state.scrollTop, 0);
});

test("render toggle: zr flips renderOn and remaps through the alternate layout", () => {
  const vp = zrVp(ZR_CURRENT, ZR_ALTERNATE, true);
  // Cursor (1,0) is visual row 2 (current) / row 1 (alternate). scrollTop 1
  // holds viewport offset 1 in current space; the flip holds it in alternate
  // space: 1 - 1 = 0.
  let state = viewer({ cursor: { line: 1, col: 0 }, scrollTop: 1, wantedCol: 5 });
  state = reduceViewer(state, "z", ZR_LINES, vp).state;
  state = reduceViewer(state, "r", ZR_LINES, vp).state;
  assert.equal(state.renderOn, false);
  assert.deepEqual(state.cursor, { line: 1, col: 0 }); // raw cursor preserved
  assert.equal(state.scrollTop, 0);
  assert.equal(state.wantedCol, null);
  assert.equal(state.scrollLeft, 0);
  // Back on: current space becomes the unprefixed layout, alternate the
  // prefixed one; offset 1 restores scrollTop 1.
  const vp2 = zrVp(ZR_ALTERNATE, ZR_CURRENT, true);
  state = reduceViewer(state, "z", ZR_LINES, vp2).state;
  state = reduceViewer(state, "r", ZR_LINES, vp2).state;
  assert.equal(state.renderOn, true);
  assert.equal(state.scrollTop, 1);
});

test("render toggle: post-flip follow clamps in the target layout space", () => {
  // Edge case from review: the cursor sits on line 3 (current-space row 6)
  // with scrollTop 5 at the bottom of the prefixed layout; after flipping
  // render off the alternate layout only has 4 rows (maxScroll 1 at vh 3).
  // The remap lands scrollTop 2, and the follow must clamp against the
  // TARGET (alternate) space to scrollTop 1 with the cursor visible at
  // offset 2 - not re-follow in the stale 8-row current space (which
  // pinned scrollTop 4 and pushed the cursor off-screen at offset -1).
  const vp = zrVp(ZR_CURRENT, ZR_ALTERNATE, true);
  let state = viewer({ cursor: { line: 3, col: 0 }, scrollTop: 5 });
  state = reduceViewer(state, "z", ZR_LINES, vp).state;
  state = reduceViewer(state, "r", ZR_LINES, vp).state;
  assert.equal(state.renderOn, false);
  assert.deepEqual(state.cursor, { line: 3, col: 0 });
  assert.equal(state.scrollTop, 1); // alternate space: 4 rows - vh 3
  // Flip back: offset 2 (alternate row 3 - scrollTop 1) carries into
  // current space (row 6 - 2 = 4), and the follow clamps in the target
  // (current) space, where scrollTop 4 is in range (maxScroll 5).
  const vp2 = zrVp(ZR_ALTERNATE, ZR_CURRENT, true);
  state = reduceViewer(state, "z", ZR_LINES, vp2).state;
  state = reduceViewer(state, "r", ZR_LINES, vp2).state;
  assert.equal(state.renderOn, true);
  assert.equal(state.scrollTop, 4);
});

test("render toggle: zr is an exact no-op when render cannot toggle", () => {
  const vp = zrVp(ZR_CURRENT, ZR_ALTERNATE, false);
  const st = viewer({ cursor: { line: 1, col: 0 }, scrollTop: 1, pending: "z" });
  const res = reduceViewer(st, "r", ZR_LINES, vp);
  assert.deepEqual(res.state, st); // exact: even the pending stroke survives
  assert.equal(res.effect, undefined);
});

test("wrap toggle: zw without display layouts flips the flag but keeps scroll state", () => {
  // No layouts: both coordinate spaces are logical, so scrollTop remaps to
  // itself and keepVisible stays on the legacy path.
  const vp = { height: 5, contentWidth: 20, maxLineWidth: 7 };
  let state = viewer({ cursor: { line: 4, col: 3 }, scrollTop: 2, wantedCol: 7, scrollLeft: 1 });
  state = reduceViewer(state, "z", LINES, vp).state;
  state = reduceViewer(state, "w", LINES, vp).state;
  assert.equal(state.wrapOn, false);
  assert.deepEqual(state.cursor, { line: 4, col: 3 });
  assert.equal(state.scrollTop, 2);
  assert.equal(state.wantedCol, null);
  assert.equal(state.scrollLeft, 0);
});

test("wrap: missing wrapOn/renderOn flags behave as ON", () => {
  // j from (0,0) moves to visual row 1 (same logical line), not line 1.
  const vp = { height: 4, contentWidth: 8, maxLineWidth: WRAP_LAYOUT.maxLineWidth, display: { current: WRAP_LAYOUT, alternate: WRAP_LAYOUT, canToggleRender: false } };
  const res = reduceViewer(viewer(), "j", WRAP_LINES, vp);
  assert.deepEqual(res.state.cursor, { line: 0, col: 8 });
  // zr with canToggleRender flips renderOn off from the implicit-on default.
  let st = viewer({ cursor: { line: 0, col: 0 } });
  st = reduceViewer(st, "z", ZR_LINES, zrVp(ZR_CURRENT, ZR_ALTERNATE, true)).state;
  st = reduceViewer(st, "r", ZR_LINES, zrVp(ZR_CURRENT, ZR_ALTERNATE, true)).state;
  assert.equal(st.renderOn, false);
});

test("wrap toggle: unmatched second strokes after z fall through", () => {
  const vp = { height: 5, contentWidth: 20, maxLineWidth: 7 };
  // zz falls through (z is not a known second stroke) and the fall-through
  // "z" arms a fresh stroke - the same protocol as any key after "g" that
  // is not a completion: regular normal handling applies.
  let state = reduceViewer(viewer(), "z", LINES, vp).state;
  state = reduceViewer(state, "z", LINES, vp).state;
  assert.equal(state.pending, "z");
  assert.deepEqual(state.cursor, { line: 0, col: 0 });
  // z then x falls through to x's normal handling (no draft here: no-op).
  state = reduceViewer(viewer(), "z", LINES, vp).state;
  const res = reduceViewer(state, "x", LINES, vp);
  assert.equal(res.state.pending, null);
  assert.equal(res.effect, undefined);
  // A digit while z is pending clears the stroke without arming a count.
  state = reduceViewer(viewer(), "z", LINES, vp).state;
  state = reduceViewer(state, "2", LINES, vp).state;
  assert.equal(state.pending, null);
  assert.equal(state.count ?? null, null);
});
