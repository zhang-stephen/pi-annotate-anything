// Line styling for the annotation viewer: the raw SGR codes painted on
// rendered lines (underline, bold, dim, intensity reset) and the
// display-column span painter that wraps styled segments into one line
// (applyStyleSpans). The span style vocabulary (SpanStyle/StyleSpan and the
// Markdown styles) lives in the TUI leaf ../tui/display.ts and is
// re-exported here so the viewer's existing imports stay valid. Consumed by
// viewer.ts (AnnotateCard) and its tests.

import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import type { DisplayStyle, StyleSpan } from "../tui/display.ts";

export type { DisplayStyle, MdSpanStyle, SpanStyle, StyleSpan } from "../tui/display.ts";

export const UNDERLINE_ON = "\x1b[4m";
export const UNDERLINE_OFF = "\x1b[24m";
// Target emphasis (spec section 2): SGR 1 bold for the cycle target's range,
// SGR 2 dim for the non-target stack members covering the cursor. SGR 22
// (normal intensity) is the exact complement of both.
export const BOLD_ON = "\x1b[1m";
export const DIM_ON = "\x1b[2m";
export const INTENSITY_OFF = "\x1b[22m";

// Wraps the given display-column spans of line (ANSI-aware, zero-width
// codes ignored) in their styles. Boundaries are walked cell by cell so
// overlapping spans compose and same-style overlaps collapse into one wrap.
// Emphasis precedence: only the strongest viewer emphasis paints per
// segment (target > dimUnderline > underline; all three include underline,
// so the weaker ones are visually redundant) - a dim span nested inside the
// target would dim the warning fg into invisibility on dark terminals.
// Markdown styles (every style name prefixed md) never enter that race:
// they compose independently on top of whichever emphasis won. Inverse
// (selection/cursor) and match (hlsearch) always compose on top too. A
// style without a registered paint (e.g. Markdown themes not wired yet)
// degrades to plain text - failure is cosmetic, never positional.
export function applyStyleSpans(line: string, spans: StyleSpan[], styles: Partial<Record<DisplayStyle, (s: string) => string>>): string {
  const total = visibleWidth(line);
  const clamped = spans
    .map((s) => ({ ...s, start: Math.max(0, Math.min(s.start, total)), end: Math.min(Math.max(0, s.end), total) }))
    .filter((s) => s.end > s.start);
  if (clamped.length === 0) return line;

  const bounds = [...new Set([0, total, ...clamped.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  let out = "";
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const active = [...new Set(clamped.filter((s) => s.start <= a && a < s.end).map((s) => s.style))];
    const strongest = active.includes("target") ? "target" : active.includes("dimUnderline") ? "dimUnderline" : active.includes("underline") ? "underline" : null;
    // All Markdown style names carry the md prefix and no viewer emphasis
    // or search style does, so the prefix check selects them without
    // duplicating the vocabulary.
    const final = active.filter((s) => s === "inverse" || s === "match" || s === "matchCurrent" || s.startsWith("md") || s === strongest);
    const seg = sliceByColumn(line, a, b - a);
    out += final.reduce((text, s) => {
      const paint = styles[s];
      return paint ? paint(text) : text;
    }, seg);
  }
  return out;
}
