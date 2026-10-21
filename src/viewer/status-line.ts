// Pure rendering of the card's two-row bottom area: the statusline row (mode
// badge, search segment, visual selection range, cursor position) above the
// cmdline row (per-mode key hints with an optional transient message, or the
// / search input with its emulated cursor cell). Like card-chrome.ts, all
// colors are injected as (text) => string functions so these helpers are
// unit-testable without a live theme and never import pi theme modules.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { ChromeColors } from "../tui/card-chrome.ts";
import type { ViewerMode } from "./state.ts";

export type CardMode = "normal" | "visualChar" | "visualLine" | "comment" | "search";

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
    hints: "hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  q/Esc close",
  },
  // While the / input is open the cmdline row shows the input itself, so the
  // hints text is empty; the badge keeps the mode line complete.
  search: { badge: "-- SEARCH --", hints: "" },
  visualChar: { badge: "-- VISUAL --", hints: "hjkl extend  o swap  c comment  Esc cancel" },
  visualLine: { badge: "-- VISUAL LINE --", hints: "hjkl extend  o swap  c comment  Esc cancel" },
  comment: { badge: "-- COMMENT --", hints: "Enter submit  ctrl+j newline  Esc cancel" },
};

// Maps ViewerMode (kebab) to the FOOTER_HINTS key (camel).
export function cardModeOf(mode: ViewerMode): CardMode {
  if (mode === "visual-char") return "visualChar";
  if (mode === "visual-line") return "visualLine";
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
  // Active incremental search, only in normal/search modes. renderStatusLine
  // shows "/pattern [rank/total]" in normal mode and just "[rank/total]" in
  // search mode; visual and comment modes never show it.
  search?: { pattern: string; rank: number; total: number } | null;
}

// Discriminated union so future input modes plug in without touching the
// chrome: "hints" shows the per-mode hint line (plus an optional transient
// message); "input" is the / search line, ready for future : command
// variants. pendingKeys is the showcmd string (count + pending stroke) for
// the hints row's right corner; a transient message owns that corner
// instead (keys are dropped while it shows), and the input row never shows
// keys regardless of the field.
export type CommandLineInput =
  | { kind: "hints"; mode: CardMode; message?: string | null; pendingKeys?: string }
  | { kind: "input"; prompt: string; value: string; cursorCol: number; message?: string | null; pendingKeys?: string };

// Raw SGR for the emulated cmdline cursor cell, mirroring viewer.ts's
// INVERSE_ON/INVERSE_OFF (defined locally so status-line keeps its imports
// to types and pi-tui only).
const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

// First n display columns of s, dropping whole characters at the cut edge
// (no ellipsis, no ANSI reset; the caller wraps and pads the result).
function headByWidth(s: string, n: number): string {
  if (n <= 0) return "";
  const chars = [...s];
  let width = 0;
  let end = 0;
  for (let i = 0; i < chars.length; i++) {
    const cw = visibleWidth(chars[i]);
    if (width + cw > n) break;
    width += cw;
    end = i + 1;
  }
  return chars.slice(0, end).join("");
}

// Last n display columns of s, dropping whole characters at the cut edge.
function tailByWidth(s: string, n: number): string {
  if (n <= 0) return "";
  const chars = [...s];
  let width = 0;
  let start = chars.length;
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = visibleWidth(chars[i]);
    if (width + cw > n) break;
    width += cw;
    start = i;
  }
  return chars.slice(start).join("");
}

// The statusline row: mode badge (accent) on the left, the 1-based cursor
// position "L:C" (dim) on the right, never truncated. Between them sits at
// most one middle segment (dim): visual modes show the selection range -
// "L:C-L:C" char-wise, "L-L" line-wise (columns are always full width
// there), normalized so the smaller position comes first - while normal mode
// shows the search query "/pattern [rank/total]" and search mode just
// "[rank/total]". Truncation order under narrow widths: the search segment
// drops first, then the selection range, each as a whole (never truncated);
// badge and position are always preserved; when the width cannot fit even a
// one-space gap the gap drops to zero rather than overflowing the panel.
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
  let searchSeg: string | null = null;
  if (input.search && (input.mode === "normal" || input.mode === "search")) {
    const { pattern, rank, total } = input.search;
    searchSeg = input.mode === "normal" ? `/${pattern} [${rank}/${total}]` : `[${rank}/${total}]`;
  }
  // Middle segments in drop-priority order: the search segment drops before
  // the selection range. The first that fits between badge and position is
  // rendered; the caller never supplies both at once.
  const segments: string[] = [];
  if (searchSeg !== null) segments.push(searchSeg);
  if (range !== null) segments.push(range);
  for (const seg of segments) {
    const segW = visibleWidth(seg);
    if (badgeW + 2 + segW + 1 + posW <= innerWidth) {
      const pad = " ".repeat(innerWidth - badgeW - 2 - segW - posW);
      return colors.accent(badge) + "  " + colors.dim(seg) + pad + colors.dim(pos);
    }
  }
  // Narrow (or non-visual): badge and position only. The gap shrinks to zero
  // when the row cannot fit one (spec: worst case is badge + position with no
  // gap); forcing one space would push the row past the panel's inner width.
  const gap = " ".repeat(Math.max(0, innerWidth - badgeW - posW));
  return colors.accent(badge) + gap + colors.dim(pos);
}

// The cmdline row, padded to the full inner width. "hints": the per-mode
// hint text in dim, cut from the right when narrow; an optional message
// (e.g. "Pattern not found: foo") renders right-aligned in accent, with the
// hints cut first to make room, and the message preserved whole unless it
// alone exceeds the width (then truncateToWidth). The pendingKeys showcmd
// string right-aligns in dim the same way when no message is showing (they
// share the corner, never coexist); the "input" variant ignores the field.
// "input": the prompt in accent, the value in default text, and one inverse
// cursor cell; on overflow the value windows tail-biased so the prompt never
// scrolls and the cursor cell stays the last column. cursorCol stays in the
// type reserved for future mid-line editing; rendering is append-only.
export function renderCommandLine(input: CommandLineInput, innerWidth: number, colors: ChromeColors): string {
  if (input.kind === "input") {
    const promptW = visibleWidth(input.prompt);
    const message = input.message ? input.message : null;
    if (message !== null) {
      // Same right-aligned widget as the hints variant (invalid-pattern
      // errors surface here while the input row stays editable): the value
      // window shrinks first, the message is preserved whole unless it
      // alone exceeds the width.
      const msgW = visibleWidth(message);
      if (msgW > innerWidth) return colors.accent(truncateToWidth(message, innerWidth, ""));
      const valueBudget = Math.max(0, innerWidth - promptW - 1 - msgW - 1);
      const value = tailByWidth(input.value, valueBudget);
      const shownW = promptW + visibleWidth(value) + 1;
      const gap = " ".repeat(Math.max(0, innerWidth - shownW - msgW));
      return colors.accent(input.prompt) + value + INVERSE_ON + " " + INVERSE_OFF + gap + colors.accent(message);
    }
    const value = tailByWidth(input.value, innerWidth - promptW - 1);
    const shownW = promptW + visibleWidth(value) + 1;
    return (
      colors.accent(input.prompt)
      + value
      + INVERSE_ON + " " + INVERSE_OFF
      + " ".repeat(Math.max(0, innerWidth - shownW))
    );
  }
  const message = input.message ? input.message : null;
  if (message === null) {
    const keys = input.pendingKeys ?? "";
    if (keys === "") {
      const shown = headByWidth(FOOTER_HINTS[input.mode].hints, innerWidth);
      return colors.dim(shown) + " ".repeat(Math.max(0, innerWidth - visibleWidth(shown)));
    }
    // Showcmd shares the transient message's right corner (the input row
    // never shows keys): the hints are cut first, the keys stay whole unless
    // they alone exceed the width, and they keep the hints' dim style.
    const keysW = visibleWidth(keys);
    if (keysW > innerWidth) return colors.dim(truncateToWidth(keys, innerWidth, ""));
    const hintBudget = innerWidth - keysW - 1;
    const shownHints = hintBudget > 0 ? headByWidth(FOOTER_HINTS[input.mode].hints, hintBudget) : "";
    const gap = " ".repeat(Math.max(0, innerWidth - keysW - visibleWidth(shownHints)));
    return colors.dim(shownHints) + gap + colors.dim(keys);
  }
  const msgW = visibleWidth(message);
  if (msgW > innerWidth) return colors.accent(truncateToWidth(message, innerWidth, ""));
  const hintBudget = innerWidth - msgW - 1;
  const shownHints = hintBudget > 0 ? headByWidth(FOOTER_HINTS[input.mode].hints, hintBudget) : "";
  const gap = " ".repeat(Math.max(0, innerWidth - msgW - visibleWidth(shownHints)));
  return colors.dim(shownHints) + gap + colors.accent(message);
}
