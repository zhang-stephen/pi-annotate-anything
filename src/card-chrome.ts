// Pure rendering helpers for the annotate card chrome: framed panel and
// floating comment box, box placement geometry, cursor-draft lookup, and
// mode-keyed footer hints. All colors are injected as (text) => string
// functions so these helpers are unit-testable without a live theme and
// never import pi theme modules; AnnotateCard maps the active pi Theme to
// the ChromeColors record.

import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";


// Color functions the chrome needs, mapped from the active pi theme by the
// caller. bg fills full rows, border paints border glyphs; dim, accent, and
// warning style footer hints, mode badges, and pending markers on the
// caller's side, so one record covers every chrome color use.
export interface ChromeColors {
  bg: (text: string) => string;
  border: (text: string) => string;
  dim: (text: string) => string;
  accent: (text: string) => string;
  warning: (text: string) => string;
}

export interface PanelOptions {
  title?: string;
  footer?: string;
  colors: ChromeColors;
}

// Top border with the title embedded: `╭─ <title> ─...─╮`. Overlong titles
// are truncated from the left (tail kept) so a trailing file name stays
// visible. All budgets are display columns, so wide chars count double and
// the row always comes out exactly `width` columns wide.
function topBorder(width: number, title: string | undefined): string {
  const inner = width - 2;
  if (!title) return "╭" + "─".repeat(inner) + "╮";
  const budget = width - 6; // room for `╭─ `, the trailing space, and one dash
  if (budget <= 0) return "╭" + "─".repeat(inner) + "╮";
  const total = visibleWidth(title);
  const kept = total > budget ? sliceByColumn(title, total - budget, budget) : title;
  const dashes = "─".repeat(width - 5 - visibleWidth(kept));
  return "╭─ " + kept + " " + dashes + "╮";
}

// One inner row: border gutters around content padded with spaces to the
// full display width (ANSI-aware via visibleWidth), the whole row
// background-filled so nothing behind the panel bleeds through.
function innerRow(content: string, width: number, colors: ChromeColors): string {
  const pad = " ".repeat(Math.max(0, width - 2 - visibleWidth(content)));
  return colors.bg(colors.border("│") + content + pad + colors.border("│"));
}

function bottomBorder(width: number): string {
  return "╰" + "─".repeat(width - 2) + "╯";
}

// Frames the panel rows: rounded border with an optional embedded title in
// the top border, each row padded to the full display width and passed
// through colors.bg, and the footer (when given) as the last inner row.
// Rows are expected to fit the inner width; overlong rows get zero padding
// rather than being silently rewritten.
export function framePanel(rows: string[], width: number, opts: PanelOptions): string[] {
  const out: string[] = [opts.colors.bg(opts.colors.border(topBorder(width, opts.title)))];
  for (const row of rows) out.push(innerRow(row, width, opts.colors));
  if (opts.footer) out.push(innerRow(opts.footer, width, opts.colors));
  out.push(opts.colors.bg(opts.colors.border(bottomBorder(width))));
  return out;
}

// Frames comment-box lines as a bordered sub-panel with an embedded title.
// Inner lines are truncated to the inner display width (ANSI-aware, with
// the pi-tui default ellipsis), padded to full width, and every row is
// background-filled.
export function frameCommentBox(lines: string[], width: number, colors: ChromeColors, title: string): string[] {
  const inner = width - 2;
  const out: string[] = [colors.bg(colors.border(topBorder(width, title)))];
  for (const line of lines) out.push(innerRow(truncateToWidth(line, inner), width, colors));
  out.push(colors.bg(colors.border(bottomBorder(width))));
  return out;
}

export interface BoxPlacement {
  top: number;
  left: number;
}

// Places the floating comment box inside the panel viewport: below the
// selection's last row by default; flipped above the selection's first row
// when the box would run past the viewport (the footer sits directly below
// viewH content rows). The left edge aligns with the selection's start
// display column, clamped to [0, innerW - boxW] so the box never crosses
// the panel's border columns. Degenerate sizes are clamped rather than
// trusted: top is clamped into [0, max(0, viewH - boxH)] so an oversized
// box or a forced flip at row 0 cannot go negative, and left clamps at 0
// when boxW exceeds innerW (callers should pre-clamp boxW to innerW).
export function commentBoxPlacement(
  selTop: number,
  selBottom: number,
  selCol: number,
  boxH: number,
  boxW: number,
  innerW: number,
  viewH: number,
): BoxPlacement {
  const fitsBelow = selBottom + 1 + boxH <= viewH;
  const rawTop = fitsBelow ? selBottom + 1 : selTop - boxH;
  const top = Math.max(0, Math.min(rawTop, Math.max(0, viewH - boxH)));
  const left = Math.max(0, Math.min(selCol, Math.max(0, innerW - boxW)));
  return { top, left };
}

// The most recent pending draft whose range covers the cursor position
// (0-based lines, raw code-unit columns): the line must lie in
// [startLine, endLine], and on a boundary line the column must have entered
// the range (col >= startCol on the start line) and not left it (col <=
// endCol on the end line). Inner lines hit at any column. Whole-line
// (V-mode) drafts have startCol 0 / endCol = line length, so they still hit
// anywhere on the line. Pending order is insertion order, so keeping the
// last hit while scanning forward returns the most recently added draft -
// the same draft `c` and `x` target. Generic over the minimal range-bearing
// shape so both the store Draft and the reducer's pending entries can use it.
export function draftAtCursor<T extends { range: { startLine: number; startCol: number; endLine: number; endCol: number } }>(
  cursorLine: number,
  cursorCol: number,
  pending: readonly T[],
): T | undefined {
  let hit: T | undefined;
  for (const d of pending) {
    const r = d.range;
    const inLines = cursorLine >= r.startLine && cursorLine <= r.endLine;
    const afterStart = cursorLine > r.startLine || cursorCol >= r.startCol;
    const beforeEnd = cursorLine < r.endLine || cursorCol <= r.endCol;
    if (inLines && afterStart && beforeEnd) hit = d;
  }
  return hit;
}

export type CardMode = "normal" | "visualChar" | "visualLine" | "comment";

export interface FooterHints {
  // Mode badge shown before the hints in the accent color. Every mode has
  // one now, including normal (-- NORMAL --).
  badge: string;
  hints: string;
}

// Footer content by mode. Badge and hints are separate fields so callers
// can color them differently (badge in accent, hints in dim).
export const FOOTER_HINTS: Record<CardMode, FooterHints> = {
  normal: {
    badge: "-- NORMAL --",
    hints: "hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close",
  },
  visualChar: { badge: "-- VISUAL --", hints: "hjkl extend  o swap  c comment  Esc cancel" },
  visualLine: { badge: "-- VISUAL LINE --", hints: "hjkl extend  o swap  c comment  Esc cancel" },
  comment: { badge: "-- COMMENT --", hints: "Enter submit  ctrl+j newline  Esc cancel" },
};
