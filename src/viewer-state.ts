// Pure vim-style viewer state machine: maps raw key strings to the next
// viewer state plus an optional effect (annotate/close). No I/O and no pi
// imports, so the TUI component stays a thin shell over this reducer.

import { rawColToDisplayCol } from "./display.ts";
import { clampPosition, normalize } from "./selection.ts";
import type { Position, Range, Selection, VisualMode } from "./selection.ts";
import { reduceComment } from "./comment-input.ts";
import type { CommentKey, CommentState } from "./comment-input.ts";
import { draftAtCursor } from "./card-chrome.ts";

export type ViewerMode = "normal" | "visual-char" | "visual-line" | "comment";

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

const HALF_PAGE = (vh: number) => Math.floor(vh / 2);

// cycleOrdinal defaults to 0 (newest target) for states constructed without
// the field, mirroring how editingDraftId treats undefined like null.
function ordinalOf(state: ViewerState): number {
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
function resetCycleOnMove(res: ViewerResult, prev: ViewerState): ViewerResult {
  const st = res.state;
  const movedOrMode =
    st.mode !== prev.mode || st.cursor.line !== prev.cursor.line || st.cursor.col !== prev.cursor.col;
  if (!movedOrMode || ordinalOf(st) === 0) return res;
  return { ...res, state: { ...st, cycleOrdinal: 0 } };
}


// Clamps scrollTop into [0, lines.length - vh], then nudges it so the cursor
// line stays inside the visible window. Then the horizontal counterparts:
// scrollLeft is clamped into [0, max(0, maxLineWidth - contentWidth + 1)]
// (the +1 covers the virtual cursor cell when the end-exclusive cursor sits
// at end of line), and the cursor's DISPLAY column (tab-expanded via
// rawColToDisplayCol) is followed with vim sidescrolloff=0 semantics:
// left of the window -> pin to the window's left edge; at or past its right
// edge -> pin to the window's right edge. Applied to every cursor-moving key.
function keepVisible(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerState {
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

function moved(state: ViewerState, to: Position, lines: string[], viewport: ViewerViewport): ViewerResult {
  // MVP simplification: no goal-column (curswant) memory - j/k onto a short
  // line loses the original column permanently. Deliberate; revisit if users
  // report it as un-vim-like.
  return { state: keepVisible({ ...state, cursor: clampPosition(to, lines) }, lines, viewport) };
}

// Comment mode routes every key through reduceComment's key set:
// \r submits, \n and \x1b\r insert newlines, \x7f backspaces, \x1b cancels.
// Any other chunk free of control characters is appended whole, so
// multi-char input (pastes, astral chars) is not dropped; chunks containing
// Esc or C0 controls (including \t) are ignored so terminal escape sequences
// never leak into the text. Tabs are rejected too: the box renderer never
// expands tabs, so a tab would misalign the wrap/cursor column math.
function toCommentKey(key: string): CommentKey | null {
  if (key === "\r") return { kind: "submit" };
  if (key === "\n" || key === "\x1b\r") return { kind: "newline" };
  if (key === "\x7f") return { kind: "backspace" };
  if (key === "\x1b") return { kind: "cancel" };
  if (key.length === 0) return null;
  for (const ch of key) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x20) return null; // Esc and C0 controls, \t included
  }
  return { kind: "char", ch: key };
}

function commentStep(state: ViewerState, key: string, lines: string[], viewport: ViewerViewport): ViewerResult {
  const mapped = toCommentKey(key);
  if (mapped === null) return { state };
  const box = state.comment ?? { text: "" }; // invariant: non-null in comment mode
  const res = reduceComment(box, mapped);
  if (res.effect === undefined) {
    return { state: keepVisible({ ...state, comment: res.state }, lines, viewport) };
  }
  if (res.effect.type === "cancel") {
    if (state.editingDraftId) {
      // Editing a pending draft: back to normal mode (no selection to
      // restore), draft untouched.
      return { state: { ...state, mode: "normal", comment: null, editingDraftId: null } };
    }
    // Back to the visual mode the selection was started in, selection intact.
    return { state: { ...state, mode: state.visualMode === "line" ? "visual-line" : "visual-char", comment: null } };
  }
  if (state.editingDraftId) {
    // Submit while editing: update the draft's comment in place; no new
    // annotation is created.
    return {
      state: { ...state, mode: "normal", anchor: null, comment: null, pending: null, editingDraftId: null },
      effect: { type: "update", draftId: state.editingDraftId, comment: res.effect.text },
    };
  }
  // Submit: annotate the CURRENT selection, clear it, stay open (no close).
  const sel: Selection = { anchor: state.anchor ?? state.cursor, cursor: state.cursor, mode: state.visualMode };
  return {
    state: { ...state, mode: "normal", anchor: null, comment: null, pending: null },
    effect: { type: "annotate", range: normalize(sel, lines), mode: state.visualMode, comment: res.effect.text },
  };
}

function handleMode(state: ViewerState, key: string, lines: string[], viewport: ViewerViewport, pending: PendingDraft[]): ViewerResult {
  const vh = Math.max(1, viewport.height);
  const visual = state.mode === "visual-char" || state.mode === "visual-line";
  switch (key) {
    case "h":
    case "\x1b[D":
      return moved(state, { ...state.cursor, col: state.cursor.col - 1 }, lines, viewport);
    case "l":
    case "\x1b[C":
      return moved(state, { ...state.cursor, col: state.cursor.col + 1 }, lines, viewport);
    case "j":
    case "\x1b[B":
      return moved(state, { line: state.cursor.line + 1, col: state.cursor.col }, lines, viewport);
    case "k":
    case "\x1b[A":
      return moved(state, { line: state.cursor.line - 1, col: state.cursor.col }, lines, viewport);
    case "0":
      return moved(state, { line: state.cursor.line, col: 0 }, lines, viewport);
    case "$": // end-exclusive convention: max clampable col equals line length
      return moved(state, { line: state.cursor.line, col: Number.MAX_SAFE_INTEGER }, lines, viewport);
    case "G":
      return moved(state, { line: lines.length - 1, col: state.cursor.col }, lines, viewport);
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

  if (state.mode === "comment") return resetCycleOnMove(commentStep(state, key, lines, viewport), state);

  // Two-stroke sequences: "g" arms "gg". A second "g" completes the jump to
  // line 0; any other key clears the pending and falls through to regular
  // normal/visual handling.
  let current = state;
  if (current.pending !== null) {
    if (key === current.pending) {
      return resetCycleOnMove(
        moved({ ...current, pending: null }, { line: 0, col: current.cursor.col }, lines, viewport),
        state,
      );
    }
    current = { ...current, pending: null };
  }

  return resetCycleOnMove(handleMode(current, key, lines, viewport, pending), state);
}
