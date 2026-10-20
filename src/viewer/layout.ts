// Layout constants and helpers for the annotation viewer: the file-area
// height budget, comment/editor box sizing, the pending-marker gutter field
// width, the horizontal scroll clamp, and the gutter width. Pure arithmetic
// on rows and columns; consumed by viewer.ts (AnnotateCard) and its tests.

// File-area height budget: the panel chrome fixes 4 rows (top + bottom
// border, statusline, cmdline), and the card is capped on tall terminals.
// The floating comment box occludes content rows and does not consume this
// budget.
export const MIN_VIEWPORT_ROWS = 1;
export const CHROME_ROWS = 4;
export const MAX_VIEWPORT_ROWS = 30;

// The comment box title (read-only previews in Task 4 reuse the same title).
export const COMMENT_BOX_TITLE = "Comment";

// Hover preview cap: 6 box rows including the 2 borders, i.e. at most 4
// comment lines (spec goal 7). The editor box instead caps at 8 rows.
export const PREVIEW_MAX_INNER_ROWS = 4;

// The comment EDITOR box: fixed width (it never resizes while typing; long
// lines soft-wrap instead) and an 8-row height cap (6 content rows), with a
// scroll window that keeps the cursor's row visible.
export const EDITOR_BOX_MAX_WIDTH = 64;
export const EDITOR_MAX_INNER_ROWS = 6;

// Width of the pending-marker gutter field: icon + spacer + count digit,
// always reserved between the line number and the content so line numbers
// never shift horizontally (see AnnotateCard.gutter in viewer.ts).
export const MARKER_FIELD_WIDTH = 3;

// Left overflow indicator (vim listchars 'precedes' with wrap off): a dim NF
// chevron replacing the first content cell when text precedes the window
// (scrollLeft > 0). The right counterpart keeps today's dim "...".

// Render-time safety net: clamps a (possibly stale) scrollLeft into
// [0, max(0, maxLineWidth - contentWidth + 1)]; the +1 covers the virtual
// cursor cell when the end-exclusive cursor sits at end of line. The reducer
// re-clamps on every cursor-moving key; this covers width changes with no
// keypress in between (terminal resize), which would otherwise slice past
// the end of every line.
export function clampScrollLeft(scrollLeft: number, maxLineWidth: number, contentWidth: number): number {
  return Math.min(Math.max(scrollLeft, 0), Math.max(0, maxLineWidth - contentWidth + 1));
}

// Gutter width for a file with lineCount lines: right-aligned line number
// (width of the largest 1-based number), a space, the pending-marker field
// (always present, blank when the line has no drafts, so line numbers never
// shift horizontally), and a space. Must stay in sync with AnnotateCard.gutter.
export function gutterWidth(lineCount: number): number {
  return String(Math.max(1, lineCount)).length + MARKER_FIELD_WIDTH + 2;
}
