// Pure vim-style viewer state machine: maps raw key strings to the next
// viewer state plus an optional effect (annotate/close). No I/O and no pi
// imports, so the TUI component stays a thin shell over this reducer.

import type { Position, Range, VisualMode } from "../core/selection.ts";
import type { CommentState } from "../tui/comment-input.ts";
import { commentStep } from "./comment-mode.ts";
import {
  clearUnusedCount,
  consumeCount,
  cycleTarget,
  HALF_PAGE,
  keepVisible,
  moved,
  ordinalOf,
  resetCycleOnMove,
  resetWantedColOnModeChange,
  stackAtCursor,
} from "./movement.ts";
import { repeatSearch, searchStep } from "./search-mode.ts";

export type ViewerMode = "normal" | "visual-char" | "visual-line" | "comment" | "search";

export interface ViewerState {
  mode: ViewerMode;
  cursor: Position;
  anchor: Position | null;
  scrollTop: number;
  // Horizontal scroll position in display columns (tab-expanded); 0 when
  // absent. Followed and clamped by keepVisible against the viewport's
  // contentWidth/maxLineWidth. Optional so callers that construct this state
  // without the field (pre-scroll callers) stay valid; the reducer treats
  // undefined like 0.
  scrollLeft?: number;
  comment: CommentState | null;
  // First key of a pending two-stroke sequence ("g" of "gg"), else null.
  // A second non-"g" key falls through to normal handling (pending cleared).
  pending: string | null;
  // char/line flavor of the active (or most recent) visual selection; kept
  // across comment mode (which hides `mode`) so the annotate effect and the
  // Esc restore use the flavor the selection was started in.
  visualMode: VisualMode;
  // Token of the pending draft being edited (normal-mode c on a line the
  // draft covers): comment mode with the box pre-filled from that draft,
  // where submit updates it and Esc restores normal mode. Optional so
  // callers that construct this state without the field (pre-edit callers)
  // stay valid; the reducer treats undefined like null.
  editingDraftId?: string | null;
  // Hover preview toggle (normal-mode p). Card-session state: survives mode
  // changes but is deliberately not persisted; defaults to true.
  previewOn: boolean;
  // Ordinal of the current cycle target within the stack of pending drafts
  // covering the cursor (see stackAtCursor; newest first), normal mode only:
  // 0 targets the most recent draft. Reset to 0 on cursor move, mode change,
  // or a newly added draft; Tab advances it modulo the stack length. Session
  // state like previewOn: never persisted. Optional so callers that construct
  // this state without the field (pre-cycle callers) stay valid; the reducer
  // treats undefined like 0.
  cycleOrdinal?: number;
  // Incremental search state (search mode): the query typed so far and the
  // position the search started from (the cursor at "/"), which Esc restores
  // and failed jumps park on. Optional so callers that construct this state
  // without the field (pre-search callers) stay valid; the reducer treats
  // undefined like null.
  search?: { query: string; origin: Position } | null;
  // Pattern of the most recent submitted search ("/q<Enter>" stores it; an
  // empty-query Enter replays it), repeated by n/N. Session state like
  // previewOn: never persisted. Optional so callers that construct this
  // state without the field (pre-search callers) stay valid; the reducer
  // treats undefined like null.
  lastSearch?: string | null;
  // Pending count prefix ({count}j / {count}G / {count}n), normal mode only:
  // digits start/extend it in reduceViewer, exactly one motion consumes it
  // (read as count ?? 1), and any other non-digit key clears it. Optional so
  // callers that construct this state without the field (pre-count callers)
  // stay valid; the reducer treats undefined like null.
  count?: number | null;
  // Goal column (vim curswant) of vertical motions: j/k capture it before
  // moving, land at min(wanted, target line length), and keep the unclamped
  // goal so crossing short lines preserves the aim. h/l/G/gg/n/N and every
  // mode transition reset it to null, which makes the next j/k fall back to
  // the cursor column. Optional so callers that construct this state without
  // the field (pre-alignment callers) stay valid; the reducer treats
  // undefined like null.
  wantedCol?: number | null;
  // Transient statusline feedback ("search hit BOTTOM...", "Pattern not
  // found", pattern compile errors): reduceViewer drops the incoming message
  // before dispatch and branches that want one set it fresh, so a message
  // survives exactly one render and a repeated identical event re-shows it.
  // Optional so callers that construct this state without the field stay
  // valid; the reducer treats undefined like null.
  message?: string | null;
}

// Minimal view of a pending annotation the reducer needs for edit (c) and
// delete (x): identity (token) for the update/delete effects, the range for
// line targeting, and the comment for pre-filling the editor. Entries of
// AnnotationStore.list() satisfy it structurally.
export interface PendingDraft {
  token: string;
  range: Range;
  comment: string;
}

export type ViewerEffect =
  | { type: "annotate"; range: Range; mode: VisualMode; comment: string }
  | { type: "update"; draftId: string; comment: string }
  | { type: "delete"; draftId: string }
  | { type: "close" };

export interface ViewerResult {
  state: ViewerState;
  effect?: ViewerEffect;
}

// Viewport options for one reduce: the content row count, the content width
// in display columns (inner width minus the gutter), and the maximum display
// width across all loaded lines (computed once at file load). The horizontal
// follow and clamp run against these; a wrong contentWidth estimate (e.g.
// before the first render) only mis-aims one follow step - the next
// cursor-moving key re-clamps.
export interface ViewerViewport {
  height: number;
  contentWidth: number;
  maxLineWidth: number;
}

function handleMode(state: ViewerState, key: string, lines: string[], viewport: ViewerViewport, pending: PendingDraft[]): ViewerResult {
  const vh = Math.max(1, viewport.height);
  const visual = state.mode === "visual-char" || state.mode === "visual-line";
  switch (key) {
    case "h":
      return consumeCount(moved({ ...state, wantedCol: null }, { ...state.cursor, col: state.cursor.col - (state.count ?? 1) }, lines, viewport));
    case "\x1b[D":
      return consumeCount(moved({ ...state, wantedCol: null }, { ...state.cursor, col: state.cursor.col - (state.count ?? 1) }, lines, viewport));
    case "l":
      return consumeCount(moved({ ...state, wantedCol: null }, { ...state.cursor, col: state.cursor.col + (state.count ?? 1) }, lines, viewport));
    case "\x1b[C":
      return consumeCount(moved({ ...state, wantedCol: null }, { ...state.cursor, col: state.cursor.col + (state.count ?? 1) }, lines, viewport));
    case "j": {
      // Goal-column memory: aim at the stored goal (or the current column on
      // a fresh session); moved() lands on it clamped to the target line and
      // the unclamped goal rides in wantedCol for the next vertical move.
      const wanted = state.wantedCol ?? state.cursor.col;
      return consumeCount(moved({ ...state, wantedCol: wanted }, { line: state.cursor.line + (state.count ?? 1), col: wanted }, lines, viewport));
    }
    case "\x1b[B": {
      const wanted = state.wantedCol ?? state.cursor.col;
      return consumeCount(moved({ ...state, wantedCol: wanted }, { line: state.cursor.line + (state.count ?? 1), col: wanted }, lines, viewport));
    }
    case "k": {
      const wanted = state.wantedCol ?? state.cursor.col;
      return consumeCount(moved({ ...state, wantedCol: wanted }, { line: state.cursor.line - (state.count ?? 1), col: wanted }, lines, viewport));
    }
    case "\x1b[A": {
      const wanted = state.wantedCol ?? state.cursor.col;
      return consumeCount(moved({ ...state, wantedCol: wanted }, { line: state.cursor.line - (state.count ?? 1), col: wanted }, lines, viewport));
    }
    case "0":
      return moved(state, { line: state.cursor.line, col: 0 }, lines, viewport);
    case "$": // end-exclusive convention: max clampable col equals line length
      return moved(state, { line: state.cursor.line, col: Number.MAX_SAFE_INTEGER }, lines, viewport);
    case "G": {
      // {count}G goes to the 1-based line `count`, clamped into the file;
      // plain G keeps the last-line jump.
      const cnt = state.count ?? null;
      const line = cnt === null ? lines.length - 1 : Math.min(Math.max(cnt - 1, 0), lines.length - 1);
      return consumeCount(moved({ ...state, wantedCol: null }, { line, col: state.cursor.col }, lines, viewport));
    }
    case "/":
      // Search entry: the cursor becomes the origin that incremental jumps
      // run from and Esc restores; any pending count is dropped.
      if (state.mode !== "normal") return { state };
      return { state: { ...state, mode: "search", search: { query: "", origin: state.cursor }, count: null } };
    case "n":
    case "N":
      if (state.mode !== "normal") return { state };
      // A jump re-aims the cursor: the goal-column session ends here.
      return repeatSearch({ ...state, wantedCol: null }, key === "n" ? 1 : -1, state.count ?? 1, lines, viewport);
    case "g":
      return { state: { ...state, pending: "g" } };
    case "\x04": // ctrl+d: half page down
      return moved(state, { line: state.cursor.line + HALF_PAGE(vh), col: state.cursor.col }, lines, viewport);
    case "\x15": // ctrl+u: half page up
      return moved(state, { line: state.cursor.line - HALF_PAGE(vh), col: state.cursor.col }, lines, viewport);
    case "\x1b[6~": // PgDn
      return moved(state, { line: state.cursor.line + vh, col: state.cursor.col }, lines, viewport);
    case "\x1b[5~": // PgUp
      return moved(state, { line: state.cursor.line - vh, col: state.cursor.col }, lines, viewport);
    case "v":
      if (state.mode === "normal") return { state: { ...state, mode: "visual-char", anchor: state.cursor, visualMode: "char" } };
      if (state.mode === "visual-char") return { state: { ...state, mode: "normal", anchor: null } };
      return { state: { ...state, mode: "visual-char", visualMode: "char" } };
    case "V":
      if (state.mode === "normal") return { state: { ...state, mode: "visual-line", anchor: state.cursor, visualMode: "line" } };
      if (state.mode === "visual-line") return { state: { ...state, mode: "normal", anchor: null } };
      return { state: { ...state, mode: "visual-line", visualMode: "line" } };
    case "o":
      if (!visual) return { state };
      // The swap moves the cursor too, so it must go through keepVisible:
      // without it, o back to a scrolled-away anchor leaves the cursor (and
      // the row, vertically) off-screen.
      return { state: keepVisible({ ...state, anchor: state.cursor, cursor: state.anchor ?? state.cursor }, lines, viewport) };
    case "c":
      if (state.mode === "normal") {
        // Editing flow: on a position a pending draft covers, reopen the
        // CURRENT cycle target's comment pre-filled; elsewhere a no-op.
        // Editing never reorders the stack (ordering is by creation time).
        const draft = cycleTarget(state.cursor.line, state.cursor.col, ordinalOf(state), pending);
        if (draft === undefined) return { state };
        return {
          state: { ...state, mode: "comment", comment: { text: draft.comment }, editingDraftId: draft.token },
        };
      }
      return { state: { ...state, mode: "comment", comment: { text: "" } } };
    case "x":
      // Delete flow: normal mode only, deleting the CURRENT cycle target.
      if (state.mode !== "normal") return { state };
      const targets = stackAtCursor(state.cursor.line, state.cursor.col, pending);
      if (targets.length === 0) return { state };
      const ordinal = ordinalOf(state) % targets.length;
      // Succession: keep the slot (the next-older draft slides up) unless the
      // target was the oldest, which wraps to 0; an emptied stack leaves no
      // target at ordinal 0. Written only when it differs, so a lone-draft
      // delete leaves the state untouched.
      const nextOrdinal = ordinal === targets.length - 1 ? 0 : ordinal;
      return {
        state: nextOrdinal === ordinalOf(state) ? state : { ...state, cycleOrdinal: nextOrdinal },
        effect: { type: "delete", draftId: targets[ordinal].token },
      };
    case "\t":
      // Stack cycling: advance the target through the drafts covering the
      // cursor, newest first, wrapping around. No-op unless at least two
      // drafts stack here; visual and comment modes never target a draft,
      // so Tab stays inert there.
      if (state.mode !== "normal") return { state };
      const stack = stackAtCursor(state.cursor.line, state.cursor.col, pending);
      if (stack.length < 2) return { state };
      return { state: { ...state, cycleOrdinal: (ordinalOf(state) + 1) % stack.length } };
    case "p":
      // Hover preview toggle: normal mode only. The value rides along through
      // every other mode-changing branch via state spread, so it survives
      // visual/comment round-trips within the card session.
      if (state.mode !== "normal") return { state };
      return { state: { ...state, previewOn: !state.previewOn } };
    case "q":
      return state.mode === "normal" ? { state, effect: { type: "close" } } : { state };
    case "\x1b":
      if (visual) return { state: { ...state, mode: "normal", anchor: null } };
      return { state, effect: { type: "close" } };
    default:
      return { state }; // unmapped key: no-op
  }
}

export function reduceViewer(
  state: ViewerState,
  key: string,
  lines: string[],
  viewport: ViewerViewport,
  // Pending annotation drafts (token/range/comment), oldest first, used to
  // target normal-mode edit (c) and delete (x); callers without pending
  // drafts may omit it.
  pending: PendingDraft[] = [],
): ViewerResult {
  // Re-clamp scrollLeft on EVERY reduce (spec): non-motion keys never reach
  // keepVisible, so without this a stale scrollLeft (e.g. after a resize with
  // no keypress, clamped only at render time) would linger in the state.
  const cw = Math.max(1, viewport.contentWidth);
  const bound = Math.max(0, viewport.maxLineWidth - cw + 1);
  const sl = Math.min(Math.max(state.scrollLeft ?? 0, 0), bound);
  if (sl !== (state.scrollLeft ?? 0)) state = { ...state, scrollLeft: sl };

  // Message lifecycle: drop the incoming message before dispatch; branches
  // that want one set it fresh. A message therefore survives exactly one
  // render, and a repeated identical event re-shows it. Only a non-null
  // incoming message is cleared in place, so message-less states stay
  // bit-for-bit unchanged (undefined stays absent).
  if ((state.message ?? null) !== null) state = { ...state, message: null };

  if (state.mode === "comment") return resetCycleOnMove(resetWantedColOnModeChange(commentStep(state, key, lines, viewport), state), state);
  if (state.mode === "search") return resetCycleOnMove(resetWantedColOnModeChange(searchStep(state, key, lines, viewport), state), state);

  // Count prefix, normal mode only, before two-stroke handling: 1-9 start a
  // pending count, 0-9 extend it; a bare 0 (no pending count) falls through
  // to the existing column-0 motion in handleMode. Digit keys do not move,
  // so they return directly.
  if (state.mode === "normal") {
    // A digit while a two-stroke is pending is swallowed: it would arm a
    // count the stroke cannot use, so drop the unmatched prefix instead and
    // change nothing else. Non-digit keys keep the fall-through below.
    if (state.pending !== null && key.length === 1 && key >= "0" && key <= "9") {
      return resetCycleOnMove({ state: { ...state, pending: null } }, state);
    }
    if (key.length === 1 && key >= "1" && key <= "9") {
      return resetCycleOnMove({ state: { ...state, count: (state.count ?? 0) * 10 + Number(key) } }, state);
    }
    if (key === "0" && (state.count ?? null) !== null) {
      return resetCycleOnMove({ state: { ...state, count: (state.count ?? 0) * 10 } }, state);
    }
  }

  // Two-stroke sequences: "g" arms "gg". A second "g" completes the jump to
  // line 0; any other key clears the pending and falls through to regular
  // normal/visual handling.
  let current = state;
  let res: ViewerResult;
  if (current.pending !== null) {
    if (key === current.pending) {
      res = moved({ ...current, pending: null, wantedCol: null }, { line: 0, col: current.cursor.col }, lines, viewport);
    } else {
      current = { ...current, pending: null };
      res = handleMode(current, key, lines, viewport, pending);
    }
  } else {
    res = handleMode(current, key, lines, viewport, pending);
  }
  return resetCycleOnMove(clearUnusedCount(resetWantedColOnModeChange(res, state), key, state), state);
}
