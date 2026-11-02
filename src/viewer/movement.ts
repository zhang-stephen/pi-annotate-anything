// Movement helpers of the viewer state machine: the viewport clamping and
// cursor-move plumbing shared by every motion (keepVisible, moved, count
// bookkeeping) plus the pending-draft stack and cycle targeting. Exported
// for state.ts (the reducer) and viewer.ts (render-time queries).

import { clampPosition } from "../core/selection.ts";
import type { Position } from "../core/selection.ts";
import { draftAtCursor } from "../tui/card-chrome.ts";
import { rawColToDisplayCol } from "../tui/display.ts";
import { toRawPosition, toVisualPosition } from "./wrap.ts";
import type { VisualLayout } from "./wrap.ts";
import type { PendingDraft, ViewerResult, ViewerState, ViewerViewport } from "./state.ts";

export const HALF_PAGE = (vh: number) => Math.floor(vh / 2);

// cycleOrdinal defaults to 0 (newest target) for states constructed without
// the field, mirroring how editingDraftId treats undefined like null.
export function ordinalOf(state: ViewerState): number {
  return state.cycleOrdinal ?? 0;
}

// showcmd: the pending keys display, in keystroke order (count prefix first):
// count 3 -> "3", pending "g" -> "g", both -> "3g", neither -> "". The count
// renders as its number (String), so leading zeros cannot appear - a bare 0
// is the column-0 motion, never stored. Derived at render time, so the
// display always shows the state of the same frame (a digit that clears the
// pending stroke can never leave a stale "3g" on screen).
export function pendingKeysOf(state: ViewerState): string {
  return ((state.count ?? null) !== null ? String(state.count) : "") + (state.pending ?? "");
}

// All pending drafts covering the cursor position, newest first (pending
// arrives oldest first). Peels the most-recent hit repeatedly with
// draftAtCursor, so coverage follows exactly the draftAtCursor rules:
// column-precise on boundary lines, whole-line V-mode drafts hit anywhere.
export function stackAtCursor<
  T extends { range: { startLine: number; startCol: number; endLine: number; endCol: number } },
>(cursorLine: number, cursorCol: number, pending: readonly T[]): T[] {
  const remaining = [...pending];
  const stack: T[] = [];
  for (
    let hit = draftAtCursor(cursorLine, cursorCol, remaining);
    hit !== undefined;
    hit = draftAtCursor(cursorLine, cursorCol, remaining)
  ) {
    stack.push(hit);
    remaining.splice(remaining.indexOf(hit), 1);
  }
  return stack;
}

// The current cycle target: stackAtCursor(...)[ordinal], with the ordinal
// taken modulo the stack length so a stale ordinal can never point past the
// end. Undefined when the cursor is on no pending draft (no target).
// Exported so the viewer can query the same target the reducer edits and
// previews.
export function cycleTarget<T extends PendingDraft>(
  cursorLine: number,
  cursorCol: number,
  ordinal: number,
  pending: readonly T[],
): T | undefined {
  const stack = stackAtCursor(cursorLine, cursorCol, pending);
  if (stack.length === 0) return undefined;
  return stack[ordinal % stack.length];
}

// cycleOrdinal lifecycle: the ordinal only survives keys that change neither
// the cursor nor the mode (Tab cycling, x deletion); any cursor move or mode
// change snaps it back to 0 (newest target) - which also covers a newly
// added draft, since the annotate flow submits out of comment mode. Applied
// post-reducer by comparing the incoming and outgoing cursor/mode, so every
// movement and mode branch is covered without touching each one.
export function resetCycleOnMove(res: ViewerResult, prev: ViewerState): ViewerResult {
  const st = res.state;
  const movedOrMode =
    st.mode !== prev.mode || st.cursor.line !== prev.cursor.line || st.cursor.col !== prev.cursor.col;
  if (!movedOrMode || ordinalOf(st) === 0) return res;
  return { ...res, state: { ...st, cycleOrdinal: 0 } };
}

// wantedCol lifecycle: the goal column belongs to one j/k session, so any
// mode transition (v/V/c/Esc//, a comment or search submit) ends the session
// and starts a fresh one. Applied post-reducer by comparing the incoming and
// outgoing mode, so every transition branch is covered without touching each
// one. Mouse clicks have no reducer touchpoint yet; when they land, they
// must reset wantedCol like any other transition.
export function resetWantedColOnModeChange(res: ViewerResult, prev: ViewerState): ViewerResult {
  const st = res.state;
  if (st.mode === prev.mode || (st.wantedCol ?? null) === null) return res;
  return { ...res, state: { ...st, wantedCol: null } };
}

// Count wrapper: a pending count applies to exactly one keypress. The count
// consumers (j/k/h/l/G/n/N and the four arrow keys) clear it
// themselves; any other non-digit key
// that returned the count unchanged still takes its normal effect but drops
// the count, so a stale count never leaks into a later motion. Only a
// non-null incoming count is cleared in place, so keys that are no-ops on
// count-less states stay bit-for-bit no-ops (undefined stays absent).
export function clearUnusedCount(res: ViewerResult, key: string, prev: ViewerState): ViewerResult {
  const isDigit = key.length === 1 && key >= "0" && key <= "9";
  const prevCount = prev.count ?? null;
  if (isDigit || prevCount === null || (res.state.count ?? null) !== prevCount) return res;
  return { ...res, state: { ...res.state, count: null } };
}

// The active visual layout for wrap-mode motion: the viewport's current
// layout when wrap is on (undefined counts as on - missing flags mean ON)
// and display layouts exist. Null selects the legacy nowrap path everywhere,
// so a viewport without display layouts keeps the pre-wrap behavior.
export function visualLayout(state: ViewerState, viewport: ViewerViewport): VisualLayout | null {
  if (state.wrapOn === false || viewport.display === undefined) return null;
  return viewport.display.current;
}

// Visual vertical following: scrollTop is a window over the wrapped rows and
// the cursor's visual row is followed with the same clamp-and-nudge rules as
// the logical path. Wrap mode never scrolls horizontally (h/l cross the soft
// segments instead), so scrollLeft pins to 0.
function keepVisibleVisual(state: ViewerState, lines: string[], viewport: ViewerViewport, layout: VisualLayout): ViewerState {
  const vh = Math.max(1, viewport.height);
  const maxScroll = Math.max(0, layout.rows.length - vh);
  let scrollTop = Math.min(Math.max(state.scrollTop, 0), maxScroll);
  const cursorRow = toVisualPosition(lines, layout, state.cursor).row;
  if (cursorRow < scrollTop) scrollTop = cursorRow;
  if (cursorRow > scrollTop + vh - 1) scrollTop = cursorRow - vh + 1;
  return {
    ...state,
    scrollTop: Math.min(Math.max(scrollTop, 0), maxScroll),
    scrollLeft: 0,
  };
}

// Clamps scrollTop into [0, lines.length - vh], then nudges it so the cursor
// line stays inside the visible window. Then the horizontal counterparts:
// scrollLeft is clamped into [0, max(0, maxLineWidth - contentWidth + 1)]
// (the +1 covers the virtual cursor cell when the end-exclusive cursor sits
// at end of line), and the cursor's DISPLAY column (tab-expanded via
// rawColToDisplayCol) is followed with vim sidescrolloff=0 semantics:
// left of the window -> pin to the window's left edge; at or past its right
// edge -> pin to the window's right edge. Applied to every cursor-moving key.
// Wrap mode (visualLayout non-null) swaps the vertical half for visual-row
// following with scrollLeft pinned to 0; the nowrap path below stays the
// single source of the legacy behavior.
export function keepVisible(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerState {
  const layout = visualLayout(state, viewport);
  if (layout !== null) return keepVisibleVisual(state, lines, viewport, layout);
  const vh = Math.max(1, viewport.height);
  const maxScroll = Math.max(0, lines.length - vh);
  let scrollTop = Math.min(Math.max(state.scrollTop, 0), maxScroll);
  if (state.cursor.line < scrollTop) scrollTop = state.cursor.line;
  if (state.cursor.line > scrollTop + vh - 1) scrollTop = state.cursor.line - vh + 1;

  const cw = Math.max(1, viewport.contentWidth);
  const bound = Math.max(0, viewport.maxLineWidth - cw + 1);
  const clampedLeft = Math.min(Math.max(state.scrollLeft ?? 0, 0), bound);
  const displayCol = rawColToDisplayCol(lines[state.cursor.line] ?? "", state.cursor.col);
  let scrollLeft = clampedLeft;
  if (displayCol < scrollLeft) scrollLeft = displayCol;
  if (displayCol >= scrollLeft + cw) scrollLeft = displayCol - cw + 1;
  return {
    ...state,
    scrollTop: Math.min(Math.max(scrollTop, 0), maxScroll),
    scrollLeft: Math.min(Math.max(scrollLeft, 0), bound),
  };
}

export function moved(state: ViewerState, to: Position, lines: string[], viewport: ViewerViewport): ViewerResult {
  // clampPosition pins the landing col to the target line's length; the
  // pre-clamp goal column survives in state.wantedCol, which the j/k arms
  // capture and re-aim on the next vertical move (vim curswant).
  return { state: keepVisible({ ...state, cursor: clampPosition(to, lines) }, lines, viewport) };
}

// Lands the cursor on a wrapped-grid cell: (row, displayCol) maps back to
// the raw position via toRawPosition (visual columns survive jumps and the
// mapping clamps out-of-range rows/columns), then the same clampPosition +
// keepVisible pipeline as moved() runs - which follows visually because the
// state is in wrap mode. wantedCol rides in the caller's state spread:
// DISPLAY columns (row-local, prefix included) in wrap mode, unclamped
// (vim curswant), while nowrap keeps raw columns.
export function moveVisual(
  state: ViewerState,
  layout: VisualLayout,
  lines: string[],
  viewport: ViewerViewport,
  row: number,
  displayCol: number,
): ViewerResult {
  const to = toRawPosition(lines, layout, row, displayCol);
  return { state: keepVisible({ ...state, cursor: clampPosition(to, lines) }, lines, viewport) };
}

// Vertical visual motion (j/k and the four arrows, count included): one
// row-delta move that keeps the unclamped DISPLAY goal column alive across
// short and prefixed rows. Null when wrap is off or layouts are missing:
// the caller falls back to the legacy logical-line path.
export function moveVisualRows(
  state: ViewerState,
  lines: string[],
  viewport: ViewerViewport,
  delta: number,
): ViewerResult | null {
  const layout = visualLayout(state, viewport);
  if (layout === null) return null;
  const pos = toVisualPosition(lines, layout, state.cursor);
  const wanted = state.wantedCol ?? pos.col;
  return consumeCount(moveVisual({ ...state, wantedCol: wanted }, layout, lines, viewport, pos.row + delta, wanted));
}

// zw: flips the soft-wrap flag without moving the raw cursor or anchor.
// scrollTop is remapped between the logical and visual coordinate spaces so
// the cursor keeps its viewport offset (each space spends one scrollTop unit
// per viewport row); wantedCol (one j/k session per coordinate space) and
// scrollLeft reset, and keepVisible re-runs in the new space. Without
// display layouts both spaces are logical, so the remap is the identity and
// keepVisible stays on the legacy path.
export function toggleWrap(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerResult {
  const wrapOn = state.wrapOn === false; // missing flag means ON: flip to false
  const display = viewport.display;
  let scrollTop = state.scrollTop;
  if (display !== undefined) {
    const cursorRow = toVisualPosition(lines, display.current, state.cursor).row;
    scrollTop = wrapOn ? cursorRow - (state.cursor.line - state.scrollTop) : state.cursor.line - (cursorRow - state.scrollTop);
  }
  return {
    state: keepVisible(
      { ...state, wrapOn, pending: null, wantedCol: null, scrollLeft: 0, scrollTop },
      lines,
      viewport,
    ),
  };
}

// zr: flips the markdown-render flag through the viewport's alternate layout
// (same wrap setting, render toggled - render changes the block prefixes and
// with them the wrap geometry, so the row coordinates shift). Exact no-op
// when render cannot toggle: the incoming state returns untouched, pending
// stroke included. With wrap off both layouts map to the logical space, so
// only the flag flips; with wrap on the cursor's row is measured in current
// and re-aimed in alternate, keeping the viewport offset across the
// geometry change. The post-flip keepVisible runs with the alternate layout
// in its usual "current" slot, so the follow and clamp land in the target
// coordinate space instead of re-following against the stale layout.
export function toggleRender(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerResult {
  const display = viewport.display;
  if (display === undefined || !display.canToggleRender) return { state };
  const renderOn = state.renderOn === false;
  const followViewport: ViewerViewport = { ...viewport, display: { ...display, current: display.alternate } };
  let scrollTop = state.scrollTop;
  if (state.wrapOn !== false) {
    const offset = toVisualPosition(lines, display.current, state.cursor).row - state.scrollTop;
    scrollTop = toVisualPosition(lines, display.alternate, state.cursor).row - offset;
  }
  return {
    state: keepVisible(
      { ...state, renderOn, pending: null, wantedCol: null, scrollLeft: 0, scrollTop },
      lines,
      followViewport,
    ),
  };
}

// Marks a motion as having consumed the pending count: the state is left
// with count null (never undefined), so the next keypress starts fresh.
// The wrapped result's optional extras pass through untouched.
export function consumeCount(res: ViewerResult): ViewerResult {
  return { ...res, state: { ...res.state, count: null } };
}
