// Pure rendering of the card's two-row bottom area: the statusline row (mode
// badge, visual selection range, cursor position) above the cmdline row
// (per-mode key hints now; the / search input and future : commands render
// here via the "input" variant). Like card-chrome.ts, all colors are
// injected as (text) => string functions so these helpers are unit-testable
// without a live theme and never import pi theme modules.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ChromeColors } from "./card-chrome.ts";
import type { ViewerMode } from "./viewer-state.ts";

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

// Maps ViewerMode (kebab) to the FOOTER_HINTS key (camel).
export function cardModeOf(mode: ViewerMode): CardMode {
  if (mode === "visual-char") return "visualChar";
  if (mode === "visual-line") return "visualLine";
  // Bridge until Task 4: search mode renders with the normal badge because
  // CardMode has no "search" yet; Task 4 adds the real mapping and badge.
  if (mode === "search") return "normal";
  return mode;
}

export interface StatusLineInput {
  mode: CardMode;
  // 1-based cursor position; col counts display columns (tab-expanded).
  cursor: { line: number; col: number };
  // Active visual selection, only in visual modes. Positions are 1-based
  // display-space like cursor; renderStatusLine normalizes so the smaller
  // position comes first.
  selection?:
    | { start: { line: number; col: number }; end: { line: number; col: number }; kind: "char" | "line" }
    | null;
}

// Discriminated union so future input modes plug in without touching the
// chrome: v1 renders only "hints"; "input" is provisioned for the / search
// spec and future : commands.
export type CommandLineInput =
  | { kind: "hints"; mode: CardMode }
  | { kind: "input"; prompt: string; value: string; cursorCol: number };

// The statusline row: mode badge (accent) on the left, the 1-based cursor
// position "L:C" (dim) on the right, never truncated. Visual modes also show
// the selection range between badge and right margin - "L:C-L:C" char-wise,
// "L-L" line-wise (columns are always full width there) - normalized so the
// smaller position comes first. Truncation order under narrow widths: the
// selection segment is dropped first, then nothing else; badge and position
// are always preserved; when the width cannot fit even a one-space gap the
// gap drops to zero rather than overflowing the panel.
export function renderStatusLine(input: StatusLineInput, innerWidth: number, colors: ChromeColors): string {
  const badge = FOOTER_HINTS[input.mode].badge;
  const badgeW = visibleWidth(badge);
  const pos = `${input.cursor.line}:${input.cursor.col}`;
  const posW = visibleWidth(pos);
  let range: string | null = null;
  if (input.selection) {
    const [a, b] = [input.selection.start, input.selection.end].sort((p, q) => p.line - q.line || p.col - q.col);
    range = input.selection.kind === "line" ? `${a.line}-${b.line}` : `${a.line}:${a.col}-${b.line}:${b.col}`;
  }
  const rangeW = range !== null ? visibleWidth(range) : 0;
  if (range !== null && badgeW + 2 + rangeW + 1 + posW <= innerWidth) {
    const pad = " ".repeat(innerWidth - badgeW - 2 - rangeW - posW);
    return colors.accent(badge) + "  " + colors.dim(range) + pad + colors.dim(pos);
  }
  // Narrow (or non-visual): badge and position only. The gap shrinks to zero
  // when the row cannot fit one (spec: worst case is badge + position with no
  // gap); forcing one space would push the row past the panel's inner width.
  const gap = " ".repeat(Math.max(0, innerWidth - badgeW - posW));
  return colors.accent(badge) + gap + colors.dim(pos);
}

// The cmdline row. "hints": the per-mode hint text in dim, truncated from
// the right when narrow. "input": interim rendering of prompt + value only,
// truncated from the right - the inverse cursor cell and its styling land
// with the / search spec. Both variants pad to the full inner width.
export function renderCommandLine(input: CommandLineInput, innerWidth: number, colors: ChromeColors): string {
  if (input.kind === "input") {
    const shown = truncateToWidth(input.prompt + input.value, innerWidth, "");
    return shown + " ".repeat(Math.max(0, innerWidth - visibleWidth(shown)));
  }
  const shown = truncateToWidth(FOOTER_HINTS[input.mode].hints, innerWidth, "");
  return colors.dim(shown) + " ".repeat(Math.max(0, innerWidth - visibleWidth(shown)));
}
