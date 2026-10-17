// Pure comment-input state machine and renderer for the annotation card.
// The box is plain ANSI-styled strings and the caller supplies the styling
// function (theme); the only pi import is pi-tui's pure visibleWidth, so
// this module stays testable without a TUI. The viewer state machine
// (viewer-state.ts) imports reduceComment and the CommentState/CommentKey
// types from here.

import { visibleWidth } from "@earendil-works/pi-tui";

// Raw SGR pairs shared with the viewer's renderer: inverse emulates the text
// cursor (theme-neutral), and the viewer uses the same pair for the file
// cursor cell and selection highlight.
export const INVERSE_ON = "\x1b[7m";
export const INVERSE_OFF = "\x1b[27m";

export interface CommentState {
  text: string;
}

export type CommentKey =
  | { kind: "char"; ch: string }
  | { kind: "newline" } // ctrl+j / shift+enter
  | { kind: "backspace" }
  | { kind: "submit" } // Enter
  | { kind: "cancel" }; // Esc

export type CommentEffect = { type: "submit"; text: string } | { type: "cancel" };

export interface CommentResult {
  state: CommentState;
  effect?: CommentEffect;
}

export function reduceComment(state: CommentState, key: CommentKey): CommentResult {
  switch (key.kind) {
    case "char":
      return { state: { text: state.text + key.ch } };
    case "newline":
      return { state: { text: state.text + "\n" } };
    case "backspace":
      if (state.text.length === 0) return { state };
      return { state: { text: state.text.slice(0, -1) } };
    case "submit":
      // State is left unchanged on purpose: the effect carries the text and
      // the card owner decides whether to reset or close the editor.
      return { state, effect: { type: "submit", text: state.text } };
    case "cancel":
      return { state, effect: { type: "cancel" } };
  }
}

export interface WrappedComment {
  // Soft-wrapped rows, each at most `width` display columns wide.
  lines: string[];
  // Row containing the text cursor, and the cursor's display column within
  // that row (equal to the row's width when the cursor sits at its end).
  cursorRow: number;
  cursorCol: number;
}

// Soft-wraps comment text at `width` display columns and locates the text
// cursor (a raw code-unit offset into `text`) in the wrapped grid. Rows break
// at newlines (hard) and just before the first character that would overflow
// `width` (soft); a wide character that does not fit starts the next row
// instead of being split. A cursor on a row boundary belongs to the row that
// ends there, so it renders as an inverse cell at that row's end.
export function wrapCommentLines(text: string, width: number, cursor: number): WrappedComment {
  const w = Math.max(1, width);
  const lines: string[] = [];
  const rowStarts: number[] = []; // absolute code-unit offset of each row's start
  const rowEnds: number[] = []; // absolute code-unit offset one past each row's end
  let base = 0; // absolute offset of the current hard line within text
  for (const hard of text.split("\n")) {
    let rowBegin = 0;
    let rowWidth = 0;
    let i = 0;
    while (i < hard.length) {
      const ch = String.fromCodePoint(hard.codePointAt(i) as number);
      const cw = visibleWidth(ch);
      if (rowWidth > 0 && rowWidth + cw > w) {
        lines.push(hard.slice(rowBegin, i));
        rowStarts.push(base + rowBegin);
        rowEnds.push(base + i);
        rowBegin = i;
        rowWidth = 0;
      }
      rowWidth += cw;
      i += ch.length;
    }
    lines.push(hard.slice(rowBegin));
    rowStarts.push(base + rowBegin);
    rowEnds.push(base + hard.length);
    base += hard.length + 1; // +1 for the "\n" the split consumed
  }

  const at = Math.min(Math.max(cursor, 0), text.length);
  let cursorRow = lines.length - 1;
  for (let k = 0; k < lines.length; k++) {
    if (rowStarts[k] <= at && at <= rowEnds[k]) {
      cursorRow = k;
      break;
    }
  }
  let cursorCol = 0;
  let i = rowStarts[cursorRow];
  while (i < at) {
    const ch = String.fromCodePoint(text.codePointAt(i) as number);
    cursorCol += visibleWidth(ch);
    i += ch.length;
  }
  return { lines, cursorRow, cursorCol };
}

// Wraps the cell under the cursor's display column of a wrapped row in SGR
// inverse (the emulated text cursor); past the row's end an inverse space is
// used instead, so the caret stays visible on empty or just-filled rows.
// The row must be plain text (comment input filters control characters), so
// raw code-unit walking is safe; a wide character covering the column is
// inverted whole.
export function withCursorCell(line: string, col: number): string {
  let width = 0;
  let i = 0;
  while (i < line.length) {
    const ch = String.fromCodePoint(line.codePointAt(i) as number);
    const cw = visibleWidth(ch);
    if (width + cw > col) {
      return line.slice(0, i) + INVERSE_ON + ch + INVERSE_OFF + line.slice(i + ch.length);
    }
    width += cw;
    i += ch.length;
  }
  return line + INVERSE_ON + " " + INVERSE_OFF;
}
