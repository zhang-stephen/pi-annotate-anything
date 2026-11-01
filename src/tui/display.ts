// Display-column helpers shared by the viewer and the viewer state
// machine: tab expansion, the raw-to-display column mapping, the shared
// span style vocabulary, and buildDisplayLine (raw line + scan plan to the
// coordinate-preserving render unit). A leaf module (depends only on
// pi-tui) so the viewer state modules can import these without depending
// back on viewer.ts.

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

// Slices [start, start + len) display columns out of a styled row. When a
// wide char straddles the left cut, its unrenderable half is replaced by a
// one-cell space placeholder (terminal convention, same as vim) instead of
// being dropped, so the slice keeps its display-column alignment with the
// source. A wide char straddling the right cut is dropped whole; the caller
// pads, which is visually identical at a row's end.
export function sliceWindow(styled: string, start: number, len: number): string {
  if (len <= 0) return "";
  const straddles =
    visibleWidth(styled) > start && visibleWidth(sliceByColumn(styled, 0, start, true)) < start;
  if (!straddles) return sliceByColumn(styled, start, len, true);
  return " " + sliceByColumn(styled, start + 1, len - 1, true);
}

export const DEFAULT_TAB_SIZE = 4;

// Smallest multiple of tabSize strictly greater than width (tab behavior).
function nextTabStop(width: number, tabSize: number): number {
  const size = Math.max(1, tabSize);
  return width - (width % size) + size;
}

// Replaces every tab in s with spaces advancing to the next multiple of
// tabSize (default 4). Widths after a tab account for wide chars, so the
// result's visibleWidth matches rawColToDisplayCol(s, s.length).
export function tabExpanded(s: string, tabSize: number = DEFAULT_TAB_SIZE): string {
  if (!s.includes("\t")) return s;
  let out = "";
  let width = 0;
  for (const ch of s) {
    if (ch === "\t") {
      const next = nextTabStop(width, tabSize);
      out += " ".repeat(next - width);
      width = next;
    } else {
      out += ch;
      width += visibleWidth(ch);
    }
  }
  return out;
}

// Maps a raw column (UTF-16 code-unit index, the Position.col convention of
// selection.ts) to its display column after tab expansion; wide chars count
// as 2 columns. Columns outside the line clamp to the line's display width.
export function rawColToDisplayCol(line: string, col: number, tabSize: number = DEFAULT_TAB_SIZE): number {
  const bounded = Math.min(Math.max(col, 0), line.length);
  let width = 0;
  let i = 0;
  while (i < bounded) {
    const ch = String.fromCodePoint(line.codePointAt(i) as number);
    width = ch === "\t" ? nextTabStop(width, tabSize) : width + visibleWidth(ch);
    i += ch.length;
  }
  return width;
}

// Maps a sorted list of raw columns to display columns in one left-to-right
// walk, so K positions cost O(line + K) instead of K rawColToDisplayCol
// calls at O(col) each (search-match rendering maps every match's start and
// end). Callers must pass cols sorted ascending; each column clamps like
// rawColToDisplayCol. Duplicate columns are fine.
export function rawColsToDisplayCols(line: string, cols: number[], tabSize: number = DEFAULT_TAB_SIZE): number[] {
  const out = new Array<number>(cols.length);
  let width = 0;
  let i = 0;
  for (let k = 0; k < cols.length; k++) {
    const target = Math.min(Math.max(cols[k], 0), line.length);
    while (i < target) {
      const ch = String.fromCodePoint(line.codePointAt(i) as number);
      width = ch === "\t" ? nextTabStop(width, tabSize) : width + visibleWidth(ch);
      i += ch.length;
    }
    out[k] = width;
  }
  return out;
}

// The span style vocabulary shared by the viewer's line painter and the
// display model. SpanStyle holds the viewer's own emphasis/search styles
// (the pending-emphasis precedence set); MdSpanStyle holds the Markdown
// rendering styles, which compose independently of that precedence;
// DisplayStyle is everything a rendered line may paint.
export type SpanStyle = "inverse" | "underline" | "target" | "dimUnderline" | "match" | "matchCurrent";
export type MdSpanStyle =
  | "mdDim"
  | "mdBold"
  | "mdItalic"
  | "mdStrike"
  | "mdHeading"
  | "mdLink"
  | "mdLinkUrl"
  | "mdCode"
  | "mdCodeBlock"
  | "mdCodeBlockBorder"
  | "mdQuote"
  | "mdQuoteBorder"
  | "mdHr"
  | "mdListBullet";
export type DisplayStyle = SpanStyle | MdSpanStyle;

// A paint range over one rendered line's display columns (start inclusive,
// end exclusive), shared by the viewer painter (applyStyleSpans) and the
// display model below.
export interface StyleSpan {
  start: number;
  end: number;
  style: DisplayStyle;
}

// A styling intent over the raw line in UTF-16 code-unit columns (the
// Position.col convention of selection.ts), mapped to display columns only
// at build time so stored coordinates never leave raw space.
export interface RawStyleSpan {
  startCol: number;
  endCol: number;
  style: DisplayStyle;
}

// One scanned line's rendering plan: a literal block prefix plus its style
// and raw-column spans. Produced by the Markdown scanner; plain lines carry
// no fields at all.
export interface DisplayScanLine {
  prefix?: string;
  prefixStyle?: DisplayStyle;
  spans?: RawStyleSpan[];
}

// The coordinate-preserving render unit for one raw line: text is what the
// renderer prints, prefixWidth is the block prefix's display width, and
// spans are display-column paint ranges over text (the prefix span, when
// present, first). Every span column maps back to raw as
// column - prefixWidth through the line's tab expansion.
export interface DisplayLine {
  raw: string;
  text: string;
  prefixWidth: number;
  spans: StyleSpan[];
}

// Builds the display line for raw: tab-expand it (or reuse highlighted, the
// per-line tab-expanded ANSI base of raw -- callers guarantee it has raw's
// visible width and column geometry, so raw columns stay authoritative),
// prepend the block prefix, and map the scan's raw-column spans to display
// columns plus the prefix offset. Raw spans are copied, sorted, and mapped
// in one batch; the scan input is never mutated, and zero-width or
// clamped-empty spans are dropped. The raw source is never reflowed or
// rewritten.
export function buildDisplayLine(raw: string, scan?: DisplayScanLine, highlighted?: string): DisplayLine {
  const prefix = scan?.prefix ?? "";
  const prefixWidth = visibleWidth(prefix);
  const text = prefix + (highlighted ?? tabExpanded(raw));
  const spans: StyleSpan[] = [];
  if (prefixWidth > 0 && scan?.prefixStyle) spans.push({ start: 0, end: prefixWidth, style: scan.prefixStyle });
  const sorted = (scan?.spans ?? [])
    .filter((s) => s.endCol > s.startCol)
    .sort((a, b) => a.startCol - b.startCol);
  if (sorted.length > 0) {
    // rawColsToDisplayCols needs ascending cols; overlapping spans make the
    // per-span pairs unsorted, so sort a flat copy and recover each column's
    // mapping by value (duplicates map identically).
    const cols = sorted.flatMap((s) => [s.startCol, s.endCol]).sort((a, b) => a - b);
    const mapped = rawColsToDisplayCols(raw, cols);
    const display = new Map<number, number>();
    for (let k = 0; k < cols.length; k++) display.set(cols[k], mapped[k]);
    for (const s of sorted) {
      const start = (display.get(s.startCol) ?? 0) + prefixWidth;
      const end = (display.get(s.endCol) ?? 0) + prefixWidth;
      if (end > start) spans.push({ start, end, style: s.style });
    }
  }
  return { raw, text, prefixWidth, spans };
}
