// Pure comment-input state machine and renderer for the annotation card.
// The box is plain ANSI-styled strings and the caller supplies the styling
// function (theme); the only pi import is pi-tui's pure visibleWidth, so
// this module stays testable without a TUI. The viewer state machine
// (viewer/state.ts and comment-mode.ts) imports reduceComment and the
// CommentState/CommentKey types from here.

import { visibleWidth } from "@earendil-works/pi-tui";

// Raw SGR pairs shared with the viewer's renderer: the viewer paints the
// file cursor cell and selection highlight with inverse (theme-neutral).
// The comment box caret does not use them anymore: it is the terminal's
// hardware cursor positioned via pi-tui's CURSOR_MARKER, with a
// fake-cursor-wrapped cell that the TUI resolves to the inverse cell when
// its showHardwareCursor flag is off (see cursorCellAt and the viewer's
// withCaret).
export const INVERSE_ON = "\x1b[7m";
export const INVERSE_OFF = "\x1b[27m";

export interface CommentState {
  text: string;
  // Caret position: a code-unit offset into text. Every writer keeps it on a
  // grapheme-cluster boundary, so left/right/backspace step whole clusters.
  caret: number;
  // Goal display column remembered across consecutive up/down presses so
  // vertical movement keeps aiming at the original column across soft wraps
  // (null/absent when the last motion was not vertical; horizontal movement
  // and edits clear it).
  goalCol?: number | null;
}

export type CommentKey =
  | { kind: "char"; ch: string }
  | { kind: "newline" } // ctrl+j / shift+enter
  | { kind: "backspace" }
  | { kind: "left" } // arrow keys, classified in viewer/comment-mode.ts
  | { kind: "right" }
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "submit" } // Enter
  | { kind: "cancel" }; // Esc

export type CommentEffect = { type: "submit"; text: string } | { type: "cancel" };

export interface CommentResult {
  state: CommentState;
  effect?: CommentEffect;
}

// Grapheme-cluster segmenter behind caret movement and row math: left/right
// and backspace step whole user-perceived characters, and wrapping/caret
// placement treat each cluster as one glyph (never splitting one across
// rows, never summing the widths inside one).
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Display width of one grapheme cluster: its BASE code point's width (2 for
// East Asian Wide/Fullwidth bases, most emoji bases included); combining
// marks and ZWJ joiners contribute 0. A cluster renders as ONE glyph of at
// most 2 columns, so its width is never the sum of its code points.
function clusterWidth(cluster: string): number {
  return visibleWidth(String.fromCodePoint(cluster.codePointAt(0) as number));
}

// Start offset of the grapheme cluster before offset `index` (the largest
// cluster boundary below it); 0 at the start of text.
function graphemeStartBefore(text: string, index: number): number {
  let start = 0;
  for (const seg of GRAPHEMES.segment(text)) {
    if (seg.index >= index) break;
    start = seg.index;
  }
  return start;
}

// End offset of the grapheme cluster at/around offset `index` (the next
// cluster boundary after it); text.length past the end.
function graphemeEndAfter(text: string, index: number): number {
  for (const seg of GRAPHEMES.segment(text)) {
    if (seg.index > index) return seg.index;
  }
  return text.length;
}

// Absolute caret offset for display column `col` within the row text.slice(rowStart,
// rowEnd): the END offset of the cluster covering that column. A caret offset
// paints the cluster it ENDS (cursorCellAt), so targeting the end puts the
// caret ON the aimed-at cell - a bare row start would paint the PREVIOUS
// row's last cell instead, visually absorbing a movement step. A column
// inside a 2-column cluster aims at that whole cluster (never split); a
// column at or past the row's width aims at the row end (the last cluster's
// end). Mirror of the caret-to-column walk in wrapCommentLines, so placement
// round-trips.
function caretAtRowColumn(text: string, rowStart: number, rowEnd: number, col: number): number {
  let width = 0;
  for (const seg of GRAPHEMES.segment(text)) {
    if (seg.index >= rowEnd) break;
    if (seg.index < rowStart) continue;
    const cw = clusterWidth(seg.segment);
    if (width + cw > col) return seg.index + seg.segment.length;
    width += cw;
  }
  return rowEnd;
}

export function reduceComment(state: CommentState, key: CommentKey, wrapWidth: number = Infinity): CommentResult {
  const text = state.text;
  const at = Math.min(Math.max(state.caret, 0), text.length);
  switch (key.kind) {
    case "char":
      return { state: { text: text.slice(0, at) + key.ch + text.slice(at), caret: at + key.ch.length } };
    case "newline":
      return { state: { text: text.slice(0, at) + "\n" + text.slice(at), caret: at + 1 } };
    case "backspace": {
      // Deletes the grapheme cluster before the caret (the whole emoji, the
      // accented character), not one code unit; no-op at the caret start.
      if (at === 0) return { state };
      const start = graphemeStartBefore(text, at);
      return { state: { text: text.slice(0, start) + text.slice(at), caret: start } };
    }
    // Left/right are PURE cluster stepping in offset space - no (row, cell)
    // round-trip. Soft-wrap crossing falls out of the caret model (see
    // cursorCellAt): the wrap boundary offset paints the previous row's last
    // cell and one cluster step further paints the next row's first cell, so
    // every press visibly moves the caret with no boundary special case.
    case "left": {
      if (at === 0) return { state };
      return { state: { text, caret: graphemeStartBefore(text, at) } };
    }
    case "right": {
      if (at >= text.length) return { state }; // absolute end: a visible no-op
      return { state: { text, caret: graphemeEndAfter(text, at) } };
    }
    case "home":
    case "end": {
      // Edges of the CURRENT wrapped row (soft or hard): home to the row's
      // first cell, end to its last. Boundary carets belong to the row that
      // ends there (wrapCommentLines' rule), so end-of-row addresses that
      // row, not the next one. The targets are END offsets of the edge
      // clusters - the offsets that PAINT on those cells (caretAtRowColumn;
      // a bare row start would paint the previous row's last cell) - so
      // sitting on a row's first cell makes home a no-op.
      const wrapped = wrapCommentLines(text, wrapWidth, at);
      const target = key.kind === "home"
        ? caretAtRowColumn(text, wrapped.rowStarts[wrapped.cursorRow], wrapped.rowEnds[wrapped.cursorRow], 0)
        : wrapped.rowEnds[wrapped.cursorRow];
      if (target === at) return { state }; // already there: bit-for-bit no-op
      return { state: { text, caret: target } };
    }
    case "up":
    case "down": {
      const wrapped = wrapCommentLines(text, wrapWidth, at);
      const target = wrapped.cursorRow + (key.kind === "up" ? -1 : 1);
      // First/last row: no-op (the remembered goal column survives, matching
      // the boundary no-ops above).
      if (target < 0 || target >= wrapped.lines.length) return { state };
      const goal = state.goalCol ?? wrapped.cursorCol;
      return { state: { text, caret: caretAtRowColumn(text, wrapped.rowStarts[target], wrapped.rowEnds[target], goal), goalCol: goal } };
    }
    case "submit":
      // State is left unchanged on purpose: the effect carries the text and
      // the card owner decides whether to reset or close the editor.
      return { state, effect: { type: "submit", text } };
    case "cancel":
      return { state, effect: { type: "cancel" } };
  }
}

export interface WrappedComment {
  // Soft-wrapped rows, each at most `width` display columns wide.
  lines: string[];
  // Absolute code-unit offset of each row's start, and one past its end, so
  // row-relative caret placement (home/end, up/down, row edges) is exact.
  rowStarts: number[];
  rowEnds: number[];
  // Row containing the text cursor, and the cursor's display column within
  // that row (equal to the row's width when the cursor sits at its end).
  cursorRow: number;
  cursorCol: number;
}

// Soft-wraps comment text at `width` display columns and locates the text
// cursor (a raw code-unit offset into `text`) in the wrapped grid. Rows break
// at newlines (hard) and just before the first grapheme cluster that would
// overflow `width` (soft); a cluster that does not fit (a wide character, an
// emoji sequence) starts the next row instead of being split. A cursor on a
// row boundary belongs to the row that ends there, so the caret paints that
// row's LAST cell - the cluster the boundary offset ends (cursorCellAt).
export function wrapCommentLines(text: string, width: number, cursor: number): WrappedComment {
  const w = Math.max(1, width);
  const lines: string[] = [];
  const rowStarts: number[] = []; // absolute code-unit offset of each row's start
  const rowEnds: number[] = []; // absolute code-unit offset one past each row's end
  let base = 0; // absolute offset of the current hard line within text
  for (const hard of text.split("\n")) {
    let rowBegin = 0;
    let rowWidth = 0;
    for (const seg of GRAPHEMES.segment(hard)) {
      const cw = clusterWidth(seg.segment);
      if (rowWidth > 0 && rowWidth + cw > w) {
        lines.push(hard.slice(rowBegin, seg.index));
        rowStarts.push(base + rowBegin);
        rowEnds.push(base + seg.index);
        rowBegin = seg.index;
        rowWidth = 0;
      }
      rowWidth += cw;
    }
    lines.push(hard.slice(rowBegin));
    rowStarts.push(base + rowBegin);
    rowEnds.push(base + hard.length);
    base += hard.length + 1; // +1 for the "\n" the split consumed
  }

  const at = Math.min(Math.max(cursor, 0), text.length); // absolute caret
  let cursorRow = lines.length - 1;
  for (let k = 0; k < lines.length; k++) {
    if (rowStarts[k] <= at && at <= rowEnds[k]) {
      cursorRow = k;
      break;
    }
  }
  // Display column of the caret cell WITHIN its row: the END column of the
  // cluster the caret paints (the cluster ending at the caret offset; the
  // viewer paints the caret cell at this column via cursorCellAt, and
  // reduceComment seeds its vertical goal from it). Rows break at cluster
  // boundaries and every caret sits on one, so skipped segments ahead of
  // the row are whole rows, never half a cluster.
  let cursorCol = 0;
  const rowStart = rowStarts[cursorRow];
  for (const seg of GRAPHEMES.segment(text)) {
    if (seg.index < rowStart) continue;
    if (seg.index + seg.segment.length > at) break; // counts only clusters the caret offset ENDS
    cursorCol += clusterWidth(seg.segment);
  }
  return { lines, rowStarts, rowEnds, cursorRow, cursorCol };
}

// Splits a wrapped row at the caret's display column into the text before
// the caret CELL, the cell itself, and the text after it. The caret model is
// "an offset paints the cluster it ENDS": the cell is the cluster occupying
// the column left of `col` (`col` is the insertion column, so the painted
// cell always exists inside the row - there is no past-the-end caret cell to
// overflow the box renderer). By construction then: a wrap boundary offset
// (a row end equal to the next row's start) paints the ENDING row's last
// cell, and one cluster step further paints the next row's first cell, so
// pure cluster stepping visibly crosses a soft wrap in one press. Column 0
// (the text start, where no cluster ends) paints the FIRST cluster; an empty
// row paints a single space; a column past the row's width clamps to the
// LAST cluster.
// The row must be plain text (comment input filters control characters); the
// walk is cluster-based, matching the wrap/caret column math: a cluster (a
// wide character, an emoji sequence) is taken whole, never half. The viewer
// composes the caret cell from the parts: pi-tui's CURSOR_MARKER (while the
// box has focus) followed by the cell wrapped in pi-tui fake-cursor markers,
// which the TUI drops when it draws the hardware cursor there and resolves
// to the inverse cell otherwise (pi's showHardwareCursor setting, a TUI-side
// flag - the component always emits the marker).
export function cursorCellAt(
  line: string,
  col: number,
): { before: string; cell: string; after: string } {
  let width = 0;
  let last: { index: number; cluster: string } | null = null;
  for (const seg of GRAPHEMES.segment(line)) {
    const cw = clusterWidth(seg.segment);
    // The cluster covering column col - 1 is the caret cell; col - 1 < 0
    // (the text start) takes the first cluster.
    if (col - 1 < width + cw) {
      return { before: line.slice(0, seg.index), cell: seg.segment, after: line.slice(seg.index + seg.segment.length) };
    }
    width += cw;
    last = { index: seg.index, cluster: seg.segment };
  }
  if (last !== null) {
    return { before: line.slice(0, last.index), cell: last.cluster, after: "" };
  }
  return { before: line, cell: " ", after: "" };
}
