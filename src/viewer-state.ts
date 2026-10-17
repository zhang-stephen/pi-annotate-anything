// Pure vim-style viewer state machine: maps raw key strings to the next
// viewer state plus an optional effect (annotate/close). No I/O and no pi
// imports, so the TUI component stays a thin shell over this reducer.

import { clampPosition, normalize } from "./selection.ts";
import type { Position, Range, Selection, VisualMode } from "./selection.ts";
import { reduceComment } from "./comment-input.ts";
import type { CommentKey, CommentState } from "./comment-input.ts";

export type ViewerMode = "normal" | "visual-char" | "visual-line" | "comment";

export interface ViewerState {
  mode: ViewerMode;
  cursor: Position;
  anchor: Position | null;
  scrollTop: number;
  comment: CommentState | null;
  // First key of a pending two-stroke sequence ("g" of "gg"), else null.
  // A second non-"g" key falls through to normal handling (pending cleared).
  pending: string | null;
  // char/line flavor of the active (or most recent) visual selection; kept
  // across comment mode (which hides `mode`) so the annotate effect and the
  // Esc restore use the flavor the selection was started in.
  visualMode: VisualMode;
}

export type ViewerEffect =
  | { type: "annotate"; range: Range; mode: VisualMode; comment: string }
  | { type: "close" };

export interface ViewerResult {
  state: ViewerState;
  effect?: ViewerEffect;
}

const HALF_PAGE = (vh: number) => Math.floor(vh / 2);

// Clamps scrollTop into [0, lines.length - vh], then nudges it so the cursor
// line stays inside the visible window. Applied to every cursor-moving key.
function keepVisible(state: ViewerState, lines: string[], vh: number): ViewerState {
  const maxScroll = Math.max(0, lines.length - vh);
  let scrollTop = Math.min(Math.max(state.scrollTop, 0), maxScroll);
  if (state.cursor.line < scrollTop) scrollTop = state.cursor.line;
  if (state.cursor.line > scrollTop + vh - 1) scrollTop = state.cursor.line - vh + 1;
  return { ...state, scrollTop: Math.min(Math.max(scrollTop, 0), maxScroll) };
}

function moved(state: ViewerState, to: Position, lines: string[], vh: number): ViewerResult {
  // MVP simplification: no goal-column (curswant) memory - j/k onto a short
  // line loses the original column permanently. Deliberate; revisit if users
  // report it as un-vim-like.
  return { state: keepVisible({ ...state, cursor: clampPosition(to, lines) }, lines, vh) };
}

// Comment mode routes every key through reduceComment's key set:
// \r submits, \n and \x1b\r insert newlines, \x7f backspaces, \x1b cancels,
// single printable chars append. Anything else is ignored.
function toCommentKey(key: string): CommentKey | null {
  if (key === "\r") return { kind: "submit" };
  if (key === "\n" || key === "\x1b\r") return { kind: "newline" };
  if (key === "\x7f") return { kind: "backspace" };
  if (key === "\x1b") return { kind: "cancel" };
  if (key.length === 1 && key >= " ") return { kind: "char", ch: key };
  return null;
}

function commentStep(state: ViewerState, key: string, lines: string[], vh: number): ViewerResult {
  const mapped = toCommentKey(key);
  if (mapped === null) return { state };
  const box = state.comment ?? { text: "" }; // invariant: non-null in comment mode
  const res = reduceComment(box, mapped);
  if (res.effect === undefined) {
    return { state: keepVisible({ ...state, comment: res.state }, lines, vh) };
  }
  if (res.effect.type === "cancel") {
    // Back to the visual mode the selection was started in, selection intact.
    return { state: { ...state, mode: state.visualMode === "line" ? "visual-line" : "visual-char", comment: null } };
  }
  // Submit: annotate the CURRENT selection, clear it, stay open (no close).
  const sel: Selection = { anchor: state.anchor ?? state.cursor, cursor: state.cursor, mode: state.visualMode };
  return {
    state: { ...state, mode: "normal", anchor: null, comment: null, pending: null },
    effect: { type: "annotate", range: normalize(sel, lines), mode: state.visualMode, comment: res.effect.text },
  };
}

function handleMode(state: ViewerState, key: string, lines: string[], vh: number): ViewerResult {
  const visual = state.mode === "visual-char" || state.mode === "visual-line";
  switch (key) {
    case "h":
    case "\x1b[D":
      return moved(state, { ...state.cursor, col: state.cursor.col - 1 }, lines, vh);
    case "l":
    case "\x1b[C":
      return moved(state, { ...state.cursor, col: state.cursor.col + 1 }, lines, vh);
    case "j":
    case "\x1b[B":
      return moved(state, { line: state.cursor.line + 1, col: state.cursor.col }, lines, vh);
    case "k":
    case "\x1b[A":
      return moved(state, { line: state.cursor.line - 1, col: state.cursor.col }, lines, vh);
    case "0":
      return moved(state, { line: state.cursor.line, col: 0 }, lines, vh);
    case "$": // end-exclusive convention: max clampable col equals line length
      return moved(state, { line: state.cursor.line, col: Number.MAX_SAFE_INTEGER }, lines, vh);
    case "G":
      return moved(state, { line: lines.length - 1, col: state.cursor.col }, lines, vh);
    case "g":
      return { state: { ...state, pending: "g" } };
    case "\x04": // ctrl+d: half page down
      return moved(state, { line: state.cursor.line + HALF_PAGE(vh), col: state.cursor.col }, lines, vh);
    case "\x15": // ctrl+u: half page up
      return moved(state, { line: state.cursor.line - HALF_PAGE(vh), col: state.cursor.col }, lines, vh);
    case "\x1b[6~": // PgDn
      return moved(state, { line: state.cursor.line + vh, col: state.cursor.col }, lines, vh);
    case "\x1b[5~": // PgUp
      return moved(state, { line: state.cursor.line - vh, col: state.cursor.col }, lines, vh);
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
      return { state: { ...state, anchor: state.cursor, cursor: state.anchor ?? state.cursor } };
    case "c":
      if (!visual) return { state };
      return { state: { ...state, mode: "comment", comment: { text: "" } } };
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
  viewport: { height: number },
): ViewerResult {
  const vh = Math.max(1, viewport.height);

  if (state.mode === "comment") return commentStep(state, key, lines, vh);

  // Two-stroke sequences: "g" arms "gg". A second "g" completes the jump to
  // line 0; any other key clears the pending and falls through to regular
  // normal/visual handling.
  let current = state;
  if (current.pending !== null) {
    if (key === current.pending) {
      return moved({ ...current, pending: null }, { line: 0, col: current.cursor.col }, lines, vh);
    }
    current = { ...current, pending: null };
  }

  return handleMode(current, key, lines, vh);
}
