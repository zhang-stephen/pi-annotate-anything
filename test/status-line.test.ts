import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";

import { cardModeOf, FOOTER_HINTS, renderCommandLine, renderStatusLine } from "../src/status-line.ts";
import type { ChromeColors } from "../src/card-chrome.ts";

// Marker color functions: wrap text so exact string assertions can see where
// each color function was applied, independent of real ANSI codes.
const colors: ChromeColors = {
  bg: (s) => `bg(${s})`,
  border: (s) => `b(${s})`,
  dim: (s) => `d(${s})`,
  accent: (s) => `a(${s})`,
  warning: (s) => `w(${s})`,
};
// Identity colors: row geometry assertions (visibleWidth) must measure the
// plain text, not the marker wrappers above.
const plain: ChromeColors = {
  bg: (s) => s,
  border: (s) => s,
  dim: (s) => s,
  accent: (s) => s,
  warning: (s) => s,
};

// renderStatusLine ---------------------------------------------------------

test("renderStatusLine lays out the badge left and the position right at full width", () => {
  const input = { mode: "normal" as const, cursor: { line: 12, col: 4 }, selection: null };
  const row = renderStatusLine(input, 40, colors);
  // Badge in accent on the left, "12:4" dim on the right, spaces between.
  assert.equal(row, "a(-- NORMAL --)" + " ".repeat(24) + "d(12:4)");
  assert.equal(visibleWidth(renderStatusLine(input, 40, plain)), 40);
});

test("renderStatusLine shows the selection range for visual-char mode", () => {
  const input = {
    mode: "visualChar" as const,
    cursor: { line: 12, col: 4 },
    selection: { start: { line: 8, col: 1 }, end: { line: 12, col: 4 }, kind: "char" as const },
  };
  const row = renderStatusLine(input, 44, colors);
  // "-- VISUAL --  8:1-12:4" on the left, the position still on the right.
  assert.equal(row.startsWith("a(-- VISUAL --)" + "  " + "d(8:1-12:4)"), true);
  assert.equal(row.endsWith("d(12:4)"), true);
  assert.equal(visibleWidth(renderStatusLine(input, 44, plain)), 44);
});

test("renderStatusLine renders a visual-line selection as L-L, smaller position first", () => {
  const row = renderStatusLine(
    {
      mode: "visualLine",
      cursor: { line: 20, col: 2 },
      selection: { start: { line: 12, col: 4 }, end: { line: 8, col: 1 }, kind: "line" },
    },
    44,
    colors,
  );
  assert.equal(row.includes("d(8-12)"), true);
  assert.equal(!row.includes("8:1"), true, "line-wise selection has no columns");
  assert.equal(visibleWidth(renderStatusLine(
    { mode: "visualLine", cursor: { line: 20, col: 2 }, selection: { start: { line: 12, col: 4 }, end: { line: 8, col: 1 }, kind: "line" } },
    44,
    plain,
  )), 44);
});

test("renderStatusLine drops the selection first on narrow widths, badge and position survive", () => {
  const input = {
    mode: "visualChar" as const,
    cursor: { line: 12, col: 4 },
    selection: { start: { line: 8, col: 1 }, end: { line: 12, col: 4 }, kind: "char" as const },
  };
  // 25 columns: badge (12) + range (8) + gap + position (4) cannot fit, so
  // the range goes; badge and position keep at least one space of gap.
  const row = renderStatusLine(input, 25, colors);
  assert.equal(row, "a(-- VISUAL --)" + " ".repeat(9) + "d(12:4)");
  assert.equal(visibleWidth(renderStatusLine(input, 25, plain)), 25);
  // Degenerate worst case: narrower than badge + one space + position drops
  // the gap to zero (badge and position survive, no overflow past inner).
  const cramped = renderStatusLine(input, 16, colors);
  assert.equal(cramped, "a(-- VISUAL --)" + "d(12:4)");
  assert.equal(visibleWidth(renderStatusLine(input, 16, plain)), 16);
});

// cardModeOf ---------------------------------------------------------------

test("cardModeOf maps kebab ViewerMode keys to the camel FOOTER_HINTS keys", () => {
  assert.equal(cardModeOf("visual-char"), "visualChar");
  assert.equal(cardModeOf("visual-line"), "visualLine");
  assert.equal(cardModeOf("normal"), "normal");
  assert.equal(cardModeOf("comment"), "comment");
});

// renderCommandLine --------------------------------------------------------

test("renderCommandLine renders the mode hints dim and pads to the inner width", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal" }, 80, colors);
  const hints = FOOTER_HINTS.normal.hints;
  assert.equal(row, "d(" + hints + ")" + " ".repeat(80 - hints.length));
  assert.equal(visibleWidth(renderCommandLine({ kind: "hints", mode: "normal" }, 80, plain)), 80);
});

test("renderCommandLine truncates wide hints from the right", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal" }, 20, colors);
  // pi-tui's truncateToWidth appends a zero-width ANSI reset when it cuts,
  // so only the prefix is asserted; the display width stays exactly 20.
  assert.equal(row.startsWith("d(hjkl move  v/V selec"), true);
  assert.equal(!row.includes("c/x"), true, "nothing past the budget survives");
  assert.equal(visibleWidth(renderCommandLine({ kind: "hints", mode: "normal" }, 20, plain)), 20);
});

test("renderCommandLine input variant renders prompt plus value (interim, no cursor cell)", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "abc", cursorCol: 4 }, 20, colors);
  // Interim rendering: prompt + value only; the inverse cursor cell and
  // styling land with the / search spec.
  assert.equal(row, "/abc" + " ".repeat(16));
  assert.equal(!row.includes("\x1b[7m"), true, "no emulated cursor cell yet");
  assert.equal(visibleWidth(row), 20);
});

// FOOTER_HINTS ------------------------------------------------------------------

test("FOOTER_HINTS normal mode carries the NORMAL badge and the full hint line", () => {
  const { badge, hints } = FOOTER_HINTS.normal;
  assert.equal(badge, "-- NORMAL --");
  assert.equal(hints, "hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close");
  assert.ok(hints.includes("c/x"), "normal hints mention c/x");
  assert.ok(hints.includes("p preview"), "normal hints mention p preview");
  assert.ok(hints.includes("q/Esc close"), "normal hints mention q/Esc close");
});

test("FOOTER_HINTS visual modes carry VISUAL badges and extend hints", () => {
  assert.equal(FOOTER_HINTS.visualChar.badge, "-- VISUAL --");
  assert.equal(FOOTER_HINTS.visualLine.badge, "-- VISUAL LINE --");
  assert.equal(FOOTER_HINTS.visualChar.hints, "hjkl extend  o swap  c comment  Esc cancel");
  assert.equal(FOOTER_HINTS.visualLine.hints, FOOTER_HINTS.visualChar.hints);
});

test("FOOTER_HINTS comment mode carries the COMMENT badge and submit hints", () => {
  assert.equal(FOOTER_HINTS.comment.badge, "-- COMMENT --");
  assert.equal(FOOTER_HINTS.comment.hints, "Enter submit  ctrl+j newline  Esc cancel");
});

test("FOOTER_HINTS exposes badge and hints as separate fields per mode", () => {
  for (const mode of ["normal", "visualChar", "visualLine", "comment"] as const) {
    const entry = FOOTER_HINTS[mode];
    assert.equal(typeof entry.hints, "string");
    assert.equal(typeof entry.badge, "string");
    assert.ok(entry.badge.length > 0);
  }
});
