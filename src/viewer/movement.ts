// Movement helpers of the viewer state machine: the viewport clamping and
// cursor-move plumbing shared by every motion (keepVisible, moved, count
// bookkeeping) plus the pending-draft stack and cycle targeting. Exported
// for state.ts (the reducer) and viewer.ts (render-time queries).

import { clampPosition } from "../core/selection.ts";
import type { Position } from "../core/selection.ts";
import { draftAtCursor } from "../tui/card-chrome.ts";
import { rawColToDisplayCol } from "../tui/display.ts";
import type { PendingDraft, ViewerResult, ViewerState, ViewerViewport } from "./state.ts";

export const HALF_PAGE = (vh: number) => Math.floor(vh / 2);

// cycleOrdinal defaults to 0 (newest target) for states constructed without
// the field, mirroring how editingDraftId treats undefined like null.
export function ordinalOf(state: ViewerState): number {
  return state.cycleOrdinal ?? 0;
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

// Clamps scrollTop into [0, lines.length - vh], then nudges it so the cursor
// line stays inside the visible window. Then the horizontal counterparts:
// scrollLeft is clamped into [0, max(0, maxLineWidth - contentWidth + 1)]
// (the +1 covers the virtual cursor cell when the end-exclusive cursor sits
// at end of line), and the cursor's DISPLAY column (tab-expanded via
// rawColToDisplayCol) is followed with vim sidescrolloff=0 semantics:
// left of the window -> pin to the window's left edge; at or past its right
// edge -> pin to the window's right edge. Applied to every cursor-moving key.
export function keepVisible(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerState {
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
  // MVP simplification: no goal-column (curswant) memory - j/k onto a short
  // line loses the original column permanently. Deliberate; revisit if users
  // report it as un-vim-like.
  return { state: keepVisible({ ...state, cursor: clampPosition(to, lines) }, lines, viewport) };
}

// Marks a motion as having consumed the pending count: the state is left
// with count null (never undefined), so the next keypress starts fresh.
// The wrapped result's optional extras pass through untouched.
export function consumeCount(res: ViewerResult): ViewerResult {
  return { ...res, state: { ...res.state, count: null } };
}
