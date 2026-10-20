// Comment mode of the viewer state machine: classifies raw keys into
// comment-input's CommentKey set and runs the comment box step (submit
// annotates the selection or updates the edited draft; cancel restores).
// Driven by state.ts, which dispatches comment-mode keys here.

import { normalize } from "../core/selection.ts";
import type { Selection } from "../core/selection.ts";
import { reduceComment } from "../tui/comment-input.ts";
import type { CommentKey } from "../tui/comment-input.ts";
import { keepVisible } from "./movement.ts";
import type { ViewerResult, ViewerState, ViewerViewport } from "./state.ts";

// Comment mode routes every key through reduceComment's key set:
// \r submits, \n and \x1b\r insert newlines, \x7f backspaces, \x1b cancels.
// Any other chunk free of control characters is appended whole, so
// multi-char input (pastes, astral chars) is not dropped; chunks containing
// Esc or C0 controls (including \t) are ignored so terminal escape sequences
// never leak into the text. Tabs are rejected too: the box renderer never
// expands tabs, so a tab would misalign the wrap/cursor column math.
export function toCommentKey(key: string): CommentKey | null {
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

export function commentStep(state: ViewerState, key: string, lines: string[], viewport: ViewerViewport): ViewerResult {
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
