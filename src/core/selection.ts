// Pure selection model shared by the viewer, reducer, and extraction.
// Positions are 0-based; `col` counts raw characters. `Range.endCol` stays
// an end-exclusive slice bound ([startCol, endCol)), but char mode is
// vim-inclusive of the cursor character: normalize() puts endCol one past
// the cursor char (clamped to the line length), so the extracted snapshot
// and the viewer's inverse-video "selected look" agree. Line mode expands
// to whole lines: endCol = lines[endLine].length.

export interface Position { line: number; col: number }
export type VisualMode = "char" | "line";
export interface Selection { anchor: Position; cursor: Position; mode: VisualMode }
export interface Range { startLine: number; startCol: number; endLine: number; endCol: number }

// Clamps pos to file bounds (line 0..lines.length-1, col 0..line length).
// The col bound is applied after the line lands, so it fits the landed line.
export function clampPosition(pos: Position, lines: string[]): Position {
  if (lines.length === 0) return { line: 0, col: 0 };
  const line = Math.min(Math.max(pos.line, 0), lines.length - 1);
  const col = Math.min(Math.max(pos.col, 0), lines[line].length);
  return { line, col };
}

function comparePositions(a: Position, b: Position): number {
  return a.line - b.line || a.col - b.col;
}

// Reduces an anchor/cursor selection to a forward Range whose endCol is an
// end-exclusive slice bound. Invariant under swapping anchor and cursor, so
// the viewer's `o` swap never changes the annotated range. Char-wise
// includes the cursor character (vim default): endCol = cursor col + 1,
// clamped to the line length, so `v` with no movement selects exactly one
// char. Line-wise discards columns: startCol = 0,
// endCol = lines[endLine].length, matching extraction slices.
export function normalize(sel: Selection, lines: string[]): Range {
  if (lines.length === 0) return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
  const anchor = clampPosition(sel.anchor, lines);
  const cursor = clampPosition(sel.cursor, lines);
  const [start, end] = comparePositions(anchor, cursor) <= 0
    ? [anchor, cursor]
    : [cursor, anchor];
  const lineMode = sel.mode === "line";
  return {
    startLine: start.line,
    startCol: lineMode ? 0 : start.col,
    endLine: end.line,
    endCol: lineMode ? lines[end.line].length : Math.min(end.col + 1, lines[end.line].length),
  };
}
