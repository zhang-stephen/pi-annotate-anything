import { test } from "node:test";
import assert from "node:assert/strict";

import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import { cardModeOf, FOOTER_HINTS, renderCommandLine, renderStatusLine } from "../../src/viewer/status-line.ts";
import type { ChromeColors } from "../../src/tui/card-chrome.ts";

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

test("statusline: normal mode shows /pattern [rank/total] between badge and position", () => {
  const row = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    40,
    plain,
  );
  assert.equal(row, "-- NORMAL --  /foo [2/7]            12:5");
});

test("statusline: search mode shows only [rank/total]", () => {
  const row = renderStatusLine(
    { mode: "search", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    40,
    plain,
  );
  assert.equal(row, "-- SEARCH --  [2/7]                 12:5");
});

test("statusline: search segment drops as a whole under narrow widths", () => {
  const row = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    20,
    plain,
  );
  assert.equal(row, "-- NORMAL --    12:5");
  const longPattern = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "x".repeat(30), rank: 1, total: 1 } },
    40,
    plain,
  );
  assert.equal(longPattern, "-- NORMAL --                        12:5");
});

test("statusline: visual and comment modes hide the search segment", () => {
  const row = renderStatusLine(
    {
      mode: "visualChar",
      cursor: { line: 12, col: 5 },
      selection: { start: { line: 3, col: 1 }, end: { line: 4, col: 2 }, kind: "char" },
      search: { pattern: "foo", rank: 2, total: 7 },
    },
    60,
    plain,
  );
  assert.ok(!row.includes("/foo"));
  assert.ok(row.includes("3:1-4:2"));
});

test("statusline: command mode shows the COMMAND badge between nothing and the position", () => {
  const input = { mode: "command" as const, cursor: { line: 12, col: 5 } };
  const row = renderStatusLine(input, 40, colors);
  // Badge in accent on the left, "12:5" dim on the right, no middle segment.
  assert.equal(row, "a(-- COMMAND --)" + " ".repeat(23) + "d(12:5)");
  assert.equal(visibleWidth(renderStatusLine(input, 40, plain)), 40);
});

test("statusline: command mode hides the search segment (guard covers normal and search only)", () => {
  const row = renderStatusLine(
    { mode: "command", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    40,
    plain,
  );
  assert.ok(!row.includes("/foo"), "no search query while command mode is active");
  assert.ok(!row.includes("[2/7]"), "no [rank/total] while command mode is active");
  assert.equal(row, "-- COMMAND --" + " ".repeat(23) + "12:5");
});

// cardModeOf ---------------------------------------------------------------

test("cardModeOf maps kebab ViewerMode keys to the camel FOOTER_HINTS keys", () => {
  assert.equal(cardModeOf("visual-char"), "visualChar");
  assert.equal(cardModeOf("visual-line"), "visualLine");
  assert.equal(cardModeOf("normal"), "normal");
  assert.equal(cardModeOf("comment"), "comment");
  assert.equal(cardModeOf("search"), "search");
});

// renderCommandLine --------------------------------------------------------

test("renderCommandLine renders the mode hints dim and pads to the inner width", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal" }, 100, colors);
  const hints = FOOTER_HINTS.normal.hints;
  assert.equal(row, "d(" + hints + ")" + " ".repeat(100 - hints.length));
  assert.equal(visibleWidth(renderCommandLine({ kind: "hints", mode: "normal" }, 100, plain)), 100);
});

test("renderCommandLine truncates wide hints from the right", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal" }, 20, colors);
  // Hints truncation is a clean width-aware cut: no ellipsis, no ANSI reset
  // inside the dim wrapper; the display width stays exactly 20.
  assert.equal(row.startsWith("d(hjkl move  v/V selec"), true);
  assert.equal(!row.includes("c/x"), true, "nothing past the budget survives");
  assert.equal(visibleWidth(renderCommandLine({ kind: "hints", mode: "normal" }, 20, plain)), 20);
});

test("renderCommandLine input variant colors the prompt accent and pads to the inner width", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "abc", cursorCol: 4 }, 20, colors);
  // Final rendering: accent prompt, default-text value, one inverse cursor
  // cell, padded to the full inner width.
  assert.equal(row, "a(/)abc\x1b[7m \x1b[27m" + " ".repeat(15));
  assert.equal(visibleWidth(renderCommandLine({ kind: "input", prompt: "/", value: "abc", cursorCol: 4 }, 20, plain)), 20);
});

test("cmdline input: prompt, value, and inverse cursor cell; padded to width", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "foo", cursorCol: 3 }, 10, plain);
  assert.equal(row, "/foo\x1b[7m \x1b[27m     ");
});

test("cmdline input: : prompt with typed value and inverse cursor cell, like search", () => {
  const row = renderCommandLine({ kind: "input", prompt: ":", value: "noh", cursorCol: 3 }, 10, plain);
  assert.equal(row, ":noh\x1b[7m \x1b[27m     ");
  // While command mode is active the hints variant renders nothing (the
  // input owns the row): empty hints mean an all-blank cmdline row.
  const hintsRow = renderCommandLine({ kind: "hints", mode: "command" }, 10, plain);
  assert.equal(hintsRow, " ".repeat(10));
});

test("cmdline input: overflow windows tail-biased, prompt and cursor stay visible", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "abcdefghijklmn", cursorCol: 14 }, 10, plain);
  assert.equal(row, "/ghijklmn\x1b[7m \x1b[27m");
});

test("cmdline hints: message right-aligned in accent, hints truncate first", () => {
  const row = renderCommandLine(
    { kind: "hints", mode: "normal", message: "Pattern not found: foo" },
    40,
    colors,
  );
  assert.equal(row, "d(hjkl move  v/V se) a(Pattern not found: foo)");
});

// FOOTER_HINTS ------------------------------------------------------------------

test("FOOTER_HINTS normal mode carries the NORMAL badge and the full hint line", () => {
  const { badge, hints } = FOOTER_HINTS.normal;
  assert.equal(badge, "-- NORMAL --");
  assert.equal(hints, "hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  :q close");
  assert.ok(hints.includes("/ search"), "normal hints mention / search");
  assert.ok(hints.includes("n/N next/prev"), "normal hints mention n/N next/prev");
  assert.ok(hints.includes("c/x"), "normal hints mention c/x");
  assert.ok(hints.includes("p preview"), "normal hints mention p preview");
  assert.ok(hints.includes(":q close"), "normal hints mention :q close");
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

test("FOOTER_HINTS search mode carries the SEARCH badge and empty hints", () => {
  assert.equal(FOOTER_HINTS.search.badge, "-- SEARCH --");
  assert.equal(FOOTER_HINTS.search.hints, "");
});

test("FOOTER_HINTS command mode carries the COMMAND badge and empty hints", () => {
  assert.equal(FOOTER_HINTS.command.badge, "-- COMMAND --");
  assert.equal(FOOTER_HINTS.command.hints, "");
});

test("FOOTER_HINTS exposes badge and hints as separate fields per mode", () => {
  for (const mode of ["normal", "visualChar", "visualLine", "comment", "search", "command"] as const) {
    const entry = FOOTER_HINTS[mode];
    assert.equal(typeof entry.hints, "string");
    assert.equal(typeof entry.badge, "string");
    assert.ok(entry.badge.length > 0);
  }
});

test("cmdline input: message renders right-aligned, value window shrinks first", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "(", cursorCol: 1, message: "bad pattern" }, 40, plain);
  assert.equal(row, "/(\x1b[7m \x1b[27m" + " ".repeat(26) + "bad pattern");
  const tight = renderCommandLine({ kind: "input", prompt: "/", value: "abcdefghijklmn", cursorCol: 14, message: "bad pattern" }, 20, plain);
  assert.equal(tight, "/ijklmn\x1b[7m \x1b[27m bad pattern");
});

test("cmdline input: an over-wide message falls back to truncation", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "x", cursorCol: 1, message: "m".repeat(25) }, 20, plain);
  assert.equal(visibleWidth(row), 20);
  assert.ok(stripTerminalSequences(row).startsWith("m".repeat(17)));
});

// renderCommandLine: pending keys (showcmd) ---------------------------------

test("renderCommandLine right-aligns pending keys in dim, hints cut to make room", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal", pendingKeys: "3" }, 40, plain);
  // Same right-corner layout as a transient message: the hints lose one
  // budget column plus the one-space gap, the keys sit flush at the edge.
  assert.equal(row, FOOTER_HINTS.normal.hints.slice(0, 38) + " 3");
  assert.equal(visibleWidth(row), 40);
  const styled = renderCommandLine({ kind: "hints", mode: "normal", pendingKeys: "3" }, 40, colors);
  assert.ok(styled.endsWith("d(3)"), "keys share the hints' dim style");
});

test("renderCommandLine drops pending keys while a message owns the right corner", () => {
  const row = renderCommandLine(
    { kind: "hints", mode: "normal", message: "Pattern not found: foo", pendingKeys: "3g" },
    40,
    colors,
  );
  // Byte-identical to the no-keys message row: the accent message keeps the
  // corner, the keys never paint (vim's shared-corner behavior).
  assert.equal(row, "d(hjkl move  v/V se) a(Pattern not found: foo)");
});

test("renderCommandLine never shows pending keys on the input row", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "foo", cursorCol: 3, pendingKeys: "3g" }, 10, plain);
  assert.equal(row, "/foo\x1b[7m \x1b[27m     ");
});

test("renderCommandLine keeps the pending-keys row sane at narrow widths", () => {
  const row = renderCommandLine({ kind: "hints", mode: "normal", pendingKeys: "3g" }, 10, plain);
  assert.equal(row, "hjkl mo 3g");
  assert.equal(visibleWidth(row), 10);
  // Degenerate: keys wider than the whole row truncate instead of clipping
  // the row or wrapping (truncateToWidth carries a trailing ANSI reset, so
  // assert on the stripped text like the over-wide message test above).
  const over = renderCommandLine({ kind: "hints", mode: "normal", pendingKeys: "3".repeat(15) }, 10, plain);
  assert.equal(visibleWidth(over), 10);
  assert.ok(stripTerminalSequences(over) === "3".repeat(10));
});
