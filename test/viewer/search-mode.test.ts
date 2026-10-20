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