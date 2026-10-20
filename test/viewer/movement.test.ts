import { test } from "node:test";
import assert from "node:assert/strict";

import { stackAtCursor, cycleTarget } from "../../src/viewer/movement.ts";
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
// Whole-line (V-mode) draft over line 5: startCol 0 / endCol = line length
// ("line 5".length = 6), so it hits anywhere on the line.
const DRAFT_V: PendingDraft = {
  token: "[a.ts:6-6]",
  range: { startLine: 5, startCol: 0, endLine: 5, endCol: 6 },
  comment: "vline",
};

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

test("reduceViewer: c in normal mode off pending lines is a no-op", () => {
  const start = viewer({ cursor: { line: 10, col: 0 } });
  const res = view(start, "c", [DRAFT_A]);
  assert.deepEqual(res.state, start);
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

test("reduceViewer: non-motion keys still re-clamp a stale scrollLeft", () => {
  // "p" never reaches keepVisible; the per-reduce clamp must handle it.
  const res = reduceViewer(viewer({ scrollLeft: 500 }), "p", [LONG_LINE], vpv(10, 100));
  assert.equal(res.state.scrollLeft, 91); // max(0, 100 - 10 + 1)
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