// Word wrap for the annotation viewer: soft-wraps tab-expanded raw lines
// into visual rows that stay mapped back to raw UTF-16 columns, so caret,
// selection, and search coordinates never leave raw space (the Position
// convention of core/selection.ts). Wrapping is cosmetic only: every row
// keeps its exact slice of the original line (the break character stays on
// the preceding row), continuation rows repeat the block prefix, and prefix
// cells that cannot fit the viewport are dropped or truncated cosmetically
// while the raw text and the raw/visual column mapping remain lossless.

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_TAB_SIZE } from "../tui/display.ts";
import type { DisplayLine, StyleSpan } from "../tui/display.ts";
import type { Position } from "../core/selection.ts";

// One visual row of a wrapped logical line: [startCol, endCol) are raw
// UTF-16 columns into the line, prefixWidth is the row's rendered prefix
// width (after cosmetic truncation), text is what the renderer prints
// (rendered prefix plus the row's slice of the tab-expanded line), and
// spans are the line's display spans sliced into row-local columns.
export interface VisualRow {
  line: number;
  startCol: number;
  endCol: number;
  continuation: boolean;
  prefixWidth: number;
  text: string;
  spans: StyleSpan[];
}

// The wrapped grid: rows in logical-line order, firstRowByLine[i] the index
// of line i's first row (rows of a line run to the next entry), and
// maxLineWidth measured from the UNWRAPPED display lines so horizontal
// scroll keeps its pre-wrap meaning.
export interface VisualLayout {
  rows: VisualRow[];
  firstRowByLine: number[];
  maxLineWidth: number;
}

// Grapheme-cluster segmenter behind the wrap walk: rows break only at
// cluster boundaries, so a wide grapheme (CJK ideograph, emoji sequence) is
// never split across rows.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Display width of one grapheme cluster in pi-tui's whole-grapheme width
// space: visibleWidth measures whole clusters (RGI emoji and ZWJ families
// count 2, terminal-spacing marks such as Indic signs count after their
// base), the same widths sliceByColumn slices row text by. The wrap walk's
// geometry therefore equals the row text slicing's geometry.

// Smallest multiple of tabSize strictly greater than width (tab behavior),
// mirroring tui/display's nextTabStop so a tab's expanded width inside the
// wrap walk matches the tab expansion buildDisplayLine applied to the text.
function nextTabStop(width: number, tabSize: number): number {
  const size = Math.max(1, tabSize);
  return width - (width % size) + size;
}

// One raw grapheme of the wrapped line: its [start, end) UTF-16 raw columns
// and its width as it occupies display.text's grapheme space (the space
// visibleWidth and sliceByColumn measure, hence the space rows render in).
interface Grapheme {
  start: number;
  end: number;
  width: number;
}

// Segments raw into graphemes width'ed in display.text's grapheme space, so
// row fitting, row text slicing, and both mapping directions share one
// geometry. Non-tab clusters render verbatim and keep their whole-cluster
// width; tabs advance over the same whole-grapheme expansion counter used
// by tui/display's tabExpanded.
function segmentGraphemes(raw: string): Grapheme[] {
  const out: Grapheme[] = [];
  let expandedWidth = 0; // tabExpanded's whole-grapheme width counter
  for (const seg of GRAPHEMES.segment(raw)) {
    let width: number;
    if (seg.segment === "\t") {
      const stop = nextTabStop(expandedWidth, DEFAULT_TAB_SIZE);
      width = stop - expandedWidth;
      expandedWidth = stop;
    } else {
      width = visibleWidth(seg.segment);
      expandedWidth += width;
    }
    out.push({ start: seg.index, end: seg.index + seg.segment.length, width });
  }
  return out;
}

// Display offset (tab-expanded, prefix excluded) of a raw UTF-16 column:
// the summed whole-grapheme widths of the clusters before it, with a
// column inside a cluster rounded up to that cluster's far edge (the
// established convention for mid-cluster raw columns).
function displayOffset(segments: Grapheme[], rawCol: number): number {
  let offset = 0;
  for (const seg of segments) {
    if (rawCol <= seg.start) break;
    offset += seg.width;
    if (rawCol < seg.end) break; // rawCol inside the cluster: far edge
  }
  return offset;
}

function isAsciiWhitespace(cluster: string): boolean {
  return cluster === " " || cluster === "\t";
}

// ASCII punctuation ranges (!"#$%&'()*+,-./ :;<=>?@ [\]^_` {|}~).
function isAsciiPunctuation(cluster: string): boolean {
  if (cluster.length !== 1) return false;
  const c = cluster.charCodeAt(0);
  return (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e);
}

// A break after grapheme k is allowed when grapheme k is Latin whitespace
// or punctuation (the break character stays on the preceding row), or when
// graphemes k and k+1 are both double-width clusters (breaks are allowed
// between CJK-class graphemes).
function breakableAfter(raw: string, graphemes: Grapheme[], k: number): boolean {
  const cluster = raw.slice(graphemes[k].start, graphemes[k].end);
  if (isAsciiWhitespace(cluster) || isAsciiPunctuation(cluster)) return true;
  return k + 1 < graphemes.length && graphemes[k].width === 2 && graphemes[k + 1].width === 2;
}

// Slices the line's display spans into row-local columns: the rendered
// prefix keeps its original [0, renderedPrefix) cells (the prefix span
// truncates with it), and the row's content slice keeps its styles,
// renumbered after the rendered prefix. Adjacent same-style pieces merge,
// so a span covering prefix plus content stays one range.
function sliceRowSpans(
  spans: StyleSpan[],
  prefixWidth: number,
  renderedPrefix: number,
  contentStart: number,
  contentEnd: number,
): StyleSpan[] {
  const out: StyleSpan[] = [];
  const push = (start: number, end: number, style: StyleSpan["style"]): void => {
    const last = out[out.length - 1];
    if (last && last.style === style && last.end === start) last.end = end;
    else out.push({ start, end, style });
  };
  for (const span of spans) {
    if (renderedPrefix > 0 && span.start < prefixWidth && span.end > 0) {
      const end = Math.min(span.end, renderedPrefix);
      if (end > span.start) push(span.start, end, span.style);
    }
    const start = Math.max(span.start, contentStart);
    const end = Math.min(span.end, contentEnd);
    if (end > start) push(renderedPrefix + start - contentStart, renderedPrefix + end - contentStart, span.style);
  }
  return out;
}

// Builds the wrapped layout for parallel raw lines and their display lines
// (lines[i]'s render unit is displays[i]). Width clamps to at least one
// content cell; a prefix that cannot fit alongside that cell is truncated
// (or dropped) cosmetically -- raw slices and the mapping stay lossless.
// Rows break after Latin whitespace or punctuation when one fits, between
// double-width CJK-class graphemes, and otherwise hard-break at the
// greatest whole-grapheme boundary that fits; a grapheme wider than the
// whole content width occupies its own row rather than being split.
export function buildVisualLayout(lines: string[], displays: DisplayLine[], width: number): VisualLayout {
  const rows: VisualRow[] = [];
  const firstRowByLine: number[] = [];
  let maxLineWidth = 0;
  const viewport = Math.max(1, width);
  for (let line = 0; line < displays.length; line++) {
    const display = displays[line];
    const raw = line < lines.length ? lines[line] : display.raw;
    maxLineWidth = Math.max(maxLineWidth, visibleWidth(display.text));
    firstRowByLine.push(rows.length);
    const renderedPrefix = Math.min(display.prefixWidth, Math.max(0, viewport - 1));
    const contentWidth = Math.max(1, viewport - renderedPrefix);
    const graphemes = segmentGraphemes(display.raw);
    let i = 0; // first grapheme of the current row
    let offset = 0; // display width of graphemes before i (tab-expanded, prefix excluded)
    let continuation = false;
    do {
      let rowWidth = 0; // display width of graphemes [i, j)
      let lastBreak = -1; // greatest breakable-after grapheme index within [i, j)
      let j = i;
      while (j < graphemes.length) {
        if (rowWidth > 0 && rowWidth + graphemes[j].width > contentWidth) break;
        rowWidth += graphemes[j].width;
        if (breakableAfter(raw, graphemes, j)) lastBreak = j;
        j++;
      }
      const breakIdx =
        j >= graphemes.length ? graphemes.length : lastBreak >= i ? lastBreak + 1 : Math.max(j, i + 1);
      let sliceWidth = 0; // display width of graphemes [i, breakIdx)
      for (let k = i; k < breakIdx; k++) sliceWidth += graphemes[k].width;
      const startCol = i < graphemes.length ? graphemes[i].start : 0;
      const endCol = breakIdx < graphemes.length ? graphemes[breakIdx].start : display.raw.length;
      const contentStart = display.prefixWidth + offset;
      const contentEnd = contentStart + sliceWidth;
      const text =
        (renderedPrefix > 0 ? sliceByColumn(display.text, 0, renderedPrefix, true) : "") +
        sliceByColumn(display.text, contentStart, contentEnd - contentStart, true);
      rows.push({
        line,
        startCol,
        endCol,
        continuation,
        prefixWidth: renderedPrefix,
        text,
        spans: sliceRowSpans(display.spans, display.prefixWidth, renderedPrefix, contentStart, contentEnd),
      });
      continuation = true;
      offset += sliceWidth;
      i = breakIdx;
    } while (i < graphemes.length);
  }
  return { rows, firstRowByLine, maxLineWidth };
}

// Maps a raw Position (logical line, raw UTF-16 column) into the wrapped
// grid: the row whose raw range covers the column (a break boundary belongs
// to the following row, the logical EOL to the last row) and the row-local
// display column (rendered prefix cells first). Out-of-bounds positions
// clamp, mirroring clampPosition.
export function toVisualPosition(lines: string[], layout: VisualLayout, pos: Position): { row: number; col: number } {
  if (layout.rows.length === 0 || layout.firstRowByLine.length === 0) return { row: 0, col: 0 };
  const line = Math.min(Math.max(pos.line, 0), layout.firstRowByLine.length - 1);
  const raw = line < lines.length ? lines[line] : "";
  const col = Math.min(Math.max(pos.col, 0), raw.length);
  const first = layout.firstRowByLine[line];
  const last = (line + 1 < layout.firstRowByLine.length ? layout.firstRowByLine[line + 1] : layout.rows.length) - 1;
  let target = last;
  for (let k = first; k <= last; k++) {
    if (col < layout.rows[k].endCol) {
      target = k;
      break;
    }
  }
  const row = layout.rows[target];
  const segments = segmentGraphemes(raw);
  const offset = displayOffset(segments, col) - displayOffset(segments, row.startCol);
  return { row: target, col: row.prefixWidth + offset };
}

// Maps a wrapped-grid cell back to its raw Position: a display column
// inside the (rendered) prefix aims at the row's start column, a column
// inside a grapheme aims at that grapheme's start (a wide grapheme is
// never split), and the row-end cell is the row's end column. Out-of-bounds
// row and column values clamp. Inverse of toVisualPosition at grapheme
// boundaries.
export function toRawPosition(lines: string[], layout: VisualLayout, row: number, displayCol: number): Position {
  if (layout.rows.length === 0) return { line: 0, col: 0 };
  const vr = layout.rows[Math.min(Math.max(row, 0), layout.rows.length - 1)];
  const line = vr.line;
  const raw = line < lines.length ? lines[line] : "";
  const segments = segmentGraphemes(raw);
  const contentWidth = displayOffset(segments, vr.endCol) - displayOffset(segments, vr.startCol);
  const col = Math.min(Math.max(displayCol, 0), vr.prefixWidth + contentWidth);
  if (col < vr.prefixWidth) return { line, col: vr.startCol };
  const target = col - vr.prefixWidth;
  let rowWidth = 0; // display width of the row's clusters before the cursor
  for (const seg of segments) {
    if (seg.end <= vr.startCol) continue; // cluster entirely above the row
    if (seg.start >= vr.endCol) break; // cluster entirely below the row
    if (rowWidth + seg.width > target) return { line, col: seg.start };
    rowWidth += seg.width;
  }
  return { line, col: vr.endCol };
}
