// Display-column helpers shared by the viewer and the viewer-state
// reducer: tab expansion and the raw-to-display column mapping. A leaf
// module (depends only on pi-tui) so viewer-state can import these without
// depending back on viewer.ts.

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
