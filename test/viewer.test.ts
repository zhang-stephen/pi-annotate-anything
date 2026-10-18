import { test } from "node:test";
import assert from "node:assert/strict";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";

import { rawColToDisplayCol, sliceWindow, tabExpanded } from "../src/display.ts";
import type { Range, VisualMode } from "../src/selection.ts";
import type { PendingDraft } from "../src/viewer-state.ts";
import { AnnotateCard, CONTINUATION_MARK, gutterWidth, normalizeKeyRepeat, PENDING_ICON } from "../src/viewer.ts";

// Pending-marker field width: a fixed 2 cells (icon renders 1 cell in NF
// Mono + 1 count digit).
const FIELD = 3;

// tabExpanded ----------------------------------------------------------------

test("tabExpanded leaves tab-free strings unchanged", () => {
  assert.equal(tabExpanded(""), "");
  assert.equal(tabExpanded("plain text", 4), "plain text");
  assert.equal(tabExpanded("no\tfree".replace("\t", "")), "nofree");
});

test("tabExpanded advances a leading tab to the first tab stop", () => {
  assert.equal(tabExpanded("\tfoo"), "    foo");
  assert.equal(tabExpanded("\tfoo", 4), "    foo");
  assert.equal(tabExpanded("\tfoo", 8), "        foo");
});

test("tabExpanded pads to the next multiple of tabSize", () => {
  assert.equal(tabExpanded("a\tb"), "a   b"); // col 1 -> 4
  assert.equal(tabExpanded("ab\tc"), "ab  c"); // col 2 -> 4
  assert.equal(tabExpanded("abc\td"), "abc d"); // col 3 -> 4
  assert.equal(tabExpanded("abcd\te"), "abcd    e"); // col 4 -> 8
});

test("tabExpanded with custom tabSize", () => {
  assert.equal(tabExpanded("ab\tc", 2), "ab  c"); // col 2 -> 4
  assert.equal(tabExpanded("a\tb", 2), "a b"); // col 1 -> 2
  assert.equal(tabExpanded("\t\tx", 2), "    x"); // stops at 2 then 4
});

test("tabExpanded accounts for wide chars before the tab", () => {
  // Wide char occupies 2 display columns, so the tab lands on stop 4.
  const expanded = tabExpanded("\u4e00\tx");
  assert.equal(expanded, "\u4e00  x");
  assert.equal(visibleWidth(expanded), 5); // wide char (2) + pad (2) + "x" (1)
});

test("tabExpanded output has the visible width rawColToDisplayCol predicts", () => {
  const line = "ab\t\u4e00\tcd";
  assert.equal(visibleWidth(tabExpanded(line)), rawColToDisplayCol(line, line.length));
});

// Highlight cache invariant ---------------------------------------------------

test("highlight cache: per-line tab expansion keeps later lines' tab stops independent", () => {
  // AnnotateCard caches highlightCode over the lines expanded per line and
  // joined with "\n" (constructor), while renderLine styles spans against
  // rawColToDisplayCol of each raw line expanded on its own. Expanding the
  // whole file as one string would carry line 1's width across the newline
  // and shift line 2's tab stops, breaking that agreement; the invariant is
  // that the cached text splits back into exactly the per-line expansions.
  const lines = ["abcdef", "\tx"];
  const cached = lines.map((l) => tabExpanded(l)).join("\n");
  const perLine = cached.split("\n");
  for (let i = 0; i < lines.length; i++) {
    assert.equal(perLine[i], tabExpanded(lines[i]));
  }
  assert.equal(perLine[1], "    x"); // tab stop 4, not 4 + "abcdef".length
});

// rawColToDisplayCol ----------------------------------------------------------

test("rawColToDisplayCol is identity on tab-free lines", () => {
  assert.equal(rawColToDisplayCol("abcdef", 0), 0);
  assert.equal(rawColToDisplayCol("abcdef", 3), 3);
  assert.equal(rawColToDisplayCol("abcdef", 6), 6);
});

test("rawColToDisplayCol expands tabs at various positions", () => {
  assert.equal(rawColToDisplayCol("a\tb", 1), 1); // before the tab
  assert.equal(rawColToDisplayCol("a\tb", 2), 4); // after the tab
  assert.equal(rawColToDisplayCol("a\tb", 3), 5);
  assert.equal(rawColToDisplayCol("\tabc", 1), 4);
  assert.equal(rawColToDisplayCol("ab\tcd", 3), 4);
  assert.equal(rawColToDisplayCol("ab\tcd", 4), 5);
});

test("rawColToDisplayCol honors custom tabSize", () => {
  assert.equal(rawColToDisplayCol("ab\tc", 3, 2), 4);
  assert.equal(rawColToDisplayCol("ab\tc", 3, 8), 8); // tab starts at width 2 -> stop 8
});

test("rawColToDisplayCol counts wide chars as two display columns", () => {
  assert.equal(rawColToDisplayCol("\u4e00ne", 1), 2);
  assert.equal(rawColToDisplayCol("\u4e00ne", 2), 3);
  assert.equal(rawColToDisplayCol("\u4e00\tx", 2), 4); // tab starts at width 2 -> stop 4
  assert.equal(rawColToDisplayCol("\u4e00\tx", 3), 5);
});

test("rawColToDisplayCol clamps out-of-range columns", () => {
  assert.equal(rawColToDisplayCol("ab", -1), 0);
  assert.equal(rawColToDisplayCol("ab", 10), 2);
  assert.equal(rawColToDisplayCol("", 0), 0);
});

// gutterWidth -----------------------------------------------------------------

test("gutterWidth covers the widest line number, marker field and separators", () => {
  assert.equal(gutterWidth(1), 1 + FIELD + 2); // number + space + field + space
  assert.equal(gutterWidth(9), 1 + FIELD + 2); // single-digit numbers
  assert.equal(gutterWidth(10), 2 + FIELD + 2); // two-digit numbers
  assert.equal(gutterWidth(100), 3 + FIELD + 2); // three-digit numbers
  assert.equal(gutterWidth(0), 1 + FIELD + 2); // degenerate: still one digit wide
});

test("gutterWidth digits track the line count magnitude", () => {
  assert.equal(gutterWidth(99), 2 + FIELD + 2);
  assert.equal(gutterWidth(9999), 4 + FIELD + 2); // four digits + separators
});

// AnnotateCard chrome ---------------------------------------------------------
//
// The card renders as a framed panel via the card-chrome helpers (framePanel,
// frameCommentBox, commentBoxPlacement, FOOTER_HINTS). These tests drive the
// real component with a stubbed TUI and a recording theme: fg/bg wrap text in
// real ANSI codes (so visibleWidth/stripTerminalSequences still work on the
// rendered rows) and log every token lookup, which lets tests pin the theme
// tokens the chrome must use (border, dim, accent, warning). The background
// is transparent by design, so bg lookups never happen.

const FG_ON = "\x1b[38;5;111m";
const FG_OFF = "\x1b[39m";
const BG_ON = "\x1b[48;5;111m";
const BG_OFF = "\x1b[49m";

interface CardHarness {
  card: AnnotateCard;
  fgCalls: { token: string; text: string }[];
  bgCalls: { token: string; text: string }[];
  pending: Range[];
  drafts: PendingDraft[];
  calls: {
    annotate: { range: Range; mode: VisualMode; comment: string }[];
    update: [string, string][];
    deleted: string[];
    closed: number;
  };
}

function makeCard(opts: { lines: string[]; path?: string; cwd?: string; rows?: number; cols?: number }): CardHarness {
  const pending: Range[] = [];
  const drafts: PendingDraft[] = [];
  const fgCalls: { token: string; text: string }[] = [];
  const bgCalls: { token: string; text: string }[] = [];
  const theme = {
    fg: (token: string, text: string) => {
      fgCalls.push({ token, text });
      return FG_ON + text + FG_OFF;
    },
    bg: (token: string, text: string) => {
      bgCalls.push({ token, text });
      return BG_ON + text + BG_OFF;
    },
  } as unknown as Theme;
  const calls = {
    annotate: [] as { range: Range; mode: VisualMode; comment: string }[],
    update: [] as [string, string][],
    deleted: [] as string[],
    closed: 0,
  };
  const tui = { terminal: { rows: opts.rows ?? 24, columns: opts.cols ?? 80 } } as unknown as TUI;
  const card = new AnnotateCard(
    tui,
    { path: opts.path ?? "/work/src/a.ts", lines: opts.lines },
    () => pending,
    (range, mode, comment) => calls.annotate.push({ range, mode, comment }),
    () => {
      calls.closed++;
    },
    (draftId, comment) => calls.update.push([draftId, comment]),
    (draftId) => calls.deleted.push(draftId),
    () => drafts,
    theme,
    opts.cwd ?? "/work",
  );
  return { card, fgCalls, bgCalls, pending, drafts, calls };
}

const strip = (row: string) => stripTerminalSequences(row);

// Panel chrome ----------------------------------------------------------------

test("render frames the card: title, statusline+cmdline footers, bottom border, uniform width", () => {
  const h = makeCard({ lines: ["alpha", "beta"] });
  const width = 80;
  const rows = h.card.render(width);
  const bare = rows.map(strip);
  assert.equal(rows.length, 6); // top border + 2 content rows + statusline + cmdline + bottom border
  assert.equal(bare[0], "╭─ Annotate: src/a.ts " + "─".repeat(57) + "╮");
  assert.equal(bare[1], "│ 1     alpha" + " ".repeat(65) + " │");
  // The panel's last two inner rows: statusline (badge + cursor position)
  // above the cmdline (per-mode hints).
  assert.ok(bare[3].startsWith("│ -- NORMAL --"));
  assert.ok(bare[3].endsWith("1:1 │"));
  assert.ok(bare[4].startsWith("│ hjkl move"));
  assert.equal(bare[5], "╰" + "─".repeat(78) + "╯");
  for (const row of rows) assert.equal(visibleWidth(row), width);
});

test("title embeds the live pending count: (N) when N > 0, re-read every render", () => {
  const h = makeCard({ lines: ["alpha", "beta", "gamma"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 2 });
  h.pending.push({ startLine: 2, startCol: 0, endLine: 2, endCol: 2 });
  let bare = h.card.render(40).map(strip);
  assert.ok(bare[0].startsWith("╭─ Annotate: src/a.ts (2) "));
  // The pending getter is re-read on every render, so a change between
  // renders is reflected without rebuilding the card.
  h.pending.pop();
  bare = h.card.render(40).map(strip);
  assert.ok(bare[0].startsWith("╭─ Annotate: src/a.ts (1) "));
});

test("chrome colors come from the theme: fg tokens; background transparent by design", () => {
  const h = makeCard({ lines: ["alpha"] });
  const rows = h.card.render(40);
  // Transparent background is permanent: pi-tui overlays repaint every cell
  // they occupy, so nothing behind the card bleeds through and no bg token
  // is looked up.
  assert.equal(h.bgCalls.length, 0);
  const tokens = new Set(h.fgCalls.map((c) => c.token));
  assert.ok(tokens.has("border"));
  assert.ok(tokens.has("dim"));
});

test("statusline and cmdline follow the mode: badge in accent, hints in dim", () => {
  const normal = makeCard({ lines: ["alpha", "beta"] });
  // Width 100 so the 90-column normal hints fit whole and reach the dim
  // token untruncated.
  let bare = normal.card.render(100).map(strip);
  assert.ok(bare[bare.length - 3].startsWith("│ -- NORMAL --"));
  assert.ok(bare[bare.length - 3].endsWith("1:1 │"));
  assert.ok(bare[bare.length - 2].startsWith("│ hjkl move  v/V select"));
  assert.ok(normal.fgCalls.some((c) => c.token === "accent" && c.text === "-- NORMAL --"));
  assert.ok(normal.fgCalls.some((c) => c.token === "dim" && c.text === "hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  q/Esc close"));

  // Visual-char: the statusline carries the selection range as L:C-L:C.
  const visual = makeCard({ lines: ["alpha", "beta"] });
  visual.card.handleInput("v");
  visual.card.handleInput("l");
  visual.card.handleInput("l");
  visual.card.handleInput("l");
  bare = visual.card.render(80).map(strip);
  assert.ok(bare[bare.length - 3].startsWith("│ -- VISUAL --"));
  assert.ok(bare[bare.length - 3].includes("1:1-1:4"));
  assert.ok(visual.fgCalls.some((c) => c.token === "accent" && c.text === "-- VISUAL --"));
  assert.ok(visual.fgCalls.some((c) => c.token === "dim" && c.text === "hjkl extend  o swap  c comment  Esc cancel"));

  // Visual-line: the selection range renders as L-L.
  const vline = makeCard({ lines: ["alpha", "beta"] });
  vline.card.handleInput("V");
  vline.card.handleInput("j");
  bare = vline.card.render(80).map(strip);
  assert.ok(bare[bare.length - 3].startsWith("│ -- VISUAL LINE --"));
  assert.ok(bare[bare.length - 3].includes("1-2"));

  const comment = makeCard({ lines: ["alpha", "beta"] });
  comment.card.handleInput("v");
  comment.card.handleInput("c");
  bare = comment.card.render(80).map(strip);
  assert.ok(bare[bare.length - 3].startsWith("│ -- COMMENT --"));
  assert.ok(bare[bare.length - 2].includes("Enter submit  ctrl+j newline  Esc cancel"));
});

// Geometry --------------------------------------------------------------------

test("content rows clip to the content width (borders + padding take 4 columns)", () => {
  const h = makeCard({ lines: ["x".repeat(60)] });
  const width = 30;
  const bare = h.card.render(width).map(strip);
  assert.equal(bare.length, 5);
  assert.equal(bare[1].length, width);
  assert.equal(bare[1], "│ 1     " + "x".repeat(20) + " │"); // cut at the window edge, no indicators
});

test("viewport budget subtracts border (2) and statusline+cmdline (2) rows", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const tall = makeCard({ lines, rows: 24 });
  // Overlay clips to floor(0.8 * 24) = 19 rows; 19 - 4 chrome = 15 content.
  assert.equal(tall.card.render(30).length, 19);
  const huge = makeCard({ lines, rows: 100 });
  assert.equal(huge.card.render(30).length, 34); // capped at MAX_VIEWPORT_ROWS (30)
  const tiny = makeCard({ lines, rows: 2 });
  assert.equal(tiny.card.render(30).length, 5); // MIN_VIEWPORT_ROWS (1) + chrome
});

test("the floating comment box does not consume viewport budget", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const h = makeCard({ lines, rows: 24 });
  const before = h.card.render(30).length;
  h.card.handleInput("v");
  h.card.handleInput("c");
  assert.equal(h.card.render(30).length, before);
});

// Horizontal content window ---------------------------------------------------
// scrollLeft windows the styled content rows by display column: the gutter
// stays fixed and sliceByColumn(strict) never half-renders a wide char at an
// edge. No edge indicators (vim's default listchars enables neither 'extends'
// nor 'precedes'; sandbox trials found them noisy).

// Distinct single-digit chars so the visible window can be asserted exactly.
const digitLine = (n: number) => Array.from({ length: n }, (_, i) => String(i % 10)).join("");

test("render windows the content at scrollLeft behind a fixed gutter", () => {
  const h = makeCard({ lines: [digitLine(100)] });
  h.card.render(30); // inner 28, padding 2, gutter 6, content width 20
  for (let i = 0; i < 30; i++) h.card.handleInput("l"); // cursor 30 -> scrollLeft 11
  const rows = h.card.render(30);
  // Window [11, 31) behind the fixed gutter; the cursor (col 30) sits on the
  // last window cell.
  assert.equal(strip(rows[1]), "│ 1     " + "12345678901234567890" + " │");
  assert.equal(visibleWidth(rows[1]), 30);
  assert.ok(rows[1].includes("\x1b[7m0\x1b[0m"), "cursor cell on the last window cell");
});

test("rows are cut at the window's right edge without indicators", () => {
  const h = makeCard({ lines: [digitLine(100)] });
  const rows = h.card.render(30).map(strip);
  // No scroll: window [0, 20), plain cut - no dots.
  assert.equal(rows[1], "│ 1     " + digitLine(20) + " │");
});

test("the inverse cursor cell stays visible inside the window", () => {
  const h = makeCard({ lines: [digitLine(100)] });
  h.card.render(30);
  for (let i = 0; i < 30; i++) h.card.handleInput("l"); // cursor 30, scrollLeft 9
  for (let i = 0; i < 4; i++) h.card.handleInput("h"); // cursor 26: inside [10, 28)
  const row = h.card.render(30)[1];
  assert.ok(row.includes("\x1b[7m6\x1b[27m"), `cursor cell windowed in, got: ${JSON.stringify(strip(row))}`);
});

test("wide chars straddling the window edge are dropped whole, rows keep exact width", () => {
  const wide = "a" + "中".repeat(20) + "b"; // display width 42
  const h = makeCard({ lines: [wide] });
  // scrollLeft 0: the 中 straddling the right edge (cols 19-20 vs window
  // [0, 20)) is dropped whole, and the row still fills exactly 30 columns.
  let rows = h.card.render(30);
  assert.equal(strip(rows[1]), "│ 1     " + "a" + "中".repeat(9) + " " + " │");
  assert.equal(visibleWidth(rows[1]), 30);
  // scrollLeft 23 (the clamp bound 42 - 20 + 1): the left window edge lands
  // exactly on a wide-char boundary. The row ends with the virtual cursor
  // cell (end-exclusive cursor), a plain space once stripped.
  h.card.render(30);
  for (let i = 0; i < 22; i++) h.card.handleInput("l"); // cursor clamps at 22 (end-exclusive), scrollLeft 23
  rows = h.card.render(30);
  assert.equal(strip(rows[1]), "│ 1     " + "中".repeat(9) + "b " + " │");
  assert.equal(visibleWidth(rows[1]), 30);
});

test("render-time clamp: stale scrollLeft beyond the bound renders without overflow", () => {
  const h = makeCard({ lines: ["x".repeat(100)] });
  h.card.render(30); // contentWidth 20
  h.card.handleInput("$"); // cursor 100 -> scrollLeft 81 (the clamp bound)
  // Re-render wider: contentWidth 110 shrinks the bound to 0, so the window
  // must re-clamp at render time (no keypress in between) instead of
  // slicing past the end of the line.
  const rows = h.card.render(120);
  assert.equal(strip(rows[1]), "│ 1     " + "x".repeat(100) + " ".repeat(11) + "│");
  assert.equal(visibleWidth(rows[1]), 120);
});

test("comment box anchors to the scroll-corrected display column", () => {
  const h = makeCard({ lines: ["x".repeat(120)] });
  h.card.render(100); // inner 98, padding 2, gutter 6, content width 90
  for (let i = 0; i < 20; i++) h.card.handleInput("l"); // cursor 20, scrollLeft 0
  h.card.handleInput("v"); // anchor at col 20
  for (let i = 0; i < 81; i++) h.card.handleInput("l"); // cursor 101 -> scrollLeft 12
  h.card.handleInput("c"); // comment box anchored at the selection start
  const row = h.card.render(100)[1];
  // selCol = gutter 6 + display col 20 - scrollLeft 12 = 14. Without the
  // scrollLeft correction the box would anchor at 26 (raw file coordinates).
  // Stripped row column: border 1 + pad 1 + selCol 14 = 16.
  assert.equal(strip(row).indexOf("╭─ Comment"), 2 + 14);
  assert.equal(visibleWidth(row), 100);
});

// Floating comment box --------------------------------------------------------
//
// The comment EDITOR box is fixed-width: min(inner, 64) columns, never
// resizing while typing; long text soft-wraps and the box caps at 8 rows
// (6 content rows), keeping the cursor's row visible. The read-only preview
// box stays content-sized with a 6-row cap.

// The editor box at width 80: content width 76 (inner minus the border
// padding), boxW 64, gutter 6 -> left edge 6 in content coordinates;
// top border "╭─ Comment " + 52 dashes + "╮"; right sliver 76 - 6 - 64 = 6.
const EDITOR_TOP = "╭─ Comment " + "─".repeat(52) + "╮";
const EDITOR_BOTTOM = "╰" + "─".repeat(62) + "╯";

const renderCommentMode = (h: CardHarness, width: number) => {
  h.card.handleInput("v");
  h.card.handleInput("c");
  return h.card.render(width).map(strip);
};

test("comment editor box has a fixed 64-column width (empty, no growing while typing)", () => {
  const lines = ["abc", "def", "ghi", "jkl", "mno"];
  const h = makeCard({ lines });
  const bare = renderCommentMode(h, 80);
  // Box floats below the selection (content row 1), left edge at the gutter:
  // the first gutter columns of the occluded row (its gutter) stay visible.
  assert.equal(bare[2], "│ 2     " + EDITOR_TOP + " ".repeat(6) + " │");
  // Inner row: emulated cursor renders as an inverse space on the empty box.
  assert.equal(bare[3], "│ 3     │" + " ".repeat(62) + "│" + " ".repeat(6) + " │");
  assert.equal(bare[4], "│ 4     " + EDITOR_BOTTOM + " ".repeat(6) + " │");
  // No push-down: 5 content rows + 4 chrome rows, unchanged by the box.
  assert.equal(bare.length, 9);
  assert.ok(bare[6].startsWith("│ -- COMMENT --"));
});

test("comment editor box keeps its fixed width while typing", () => {
  const lines = ["abc", "def", "ghi", "jkl", "mno"];
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  const before = h.card.render(80).map(strip);
  h.card.handleInput("hi");
  const after = h.card.render(80).map(strip);
  assert.equal(after[2], before[2]); // identical top border: same fixed width
  assert.equal(after[3], "│ 3     │ hi " + " ".repeat(57) + " │" + " ".repeat(6) + " │");
  // The cursor cell under the just-typed text is the inverse space after it.
  const raw = h.card.render(80);
  assert.ok(raw[3].includes("\x1b[7m \x1b[27m"), "emulated inverse cursor at end of text");
});

test("comment text soft-wraps at the box's inner content width", () => {
  const lines = ["abc", "def", "ghi", "jkl", "mno"];
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("b".repeat(70)); // wrap width 60 -> 60 + 10
  const bare = h.card.render(80).map(strip);
  assert.equal(bare[2], "│ 2     " + EDITOR_TOP + " ".repeat(6) + " │");
  assert.equal(bare[3], "│ 3     │ " + "b".repeat(60) + " │" + " ".repeat(6) + " │");
  assert.equal(bare[4], "│ 4     │ " + "b".repeat(10) + " " + " ".repeat(49) + " │" + " ".repeat(6) + " │");
  assert.equal(bare[5], "│ 5     " + EDITOR_BOTTOM + " ".repeat(6) + " │");
});

test("comment box caps at 8 rows and keeps the cursor's row visible", () => {
  const lines = Array.from({ length: 9 }, (_, i) => `pad${i}`);
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("a".repeat(400)); // wrap width 60 -> 7 rows of 60/60/60/60/60/60/40
  const bare = h.card.render(80).map(strip);
  // Box occupies content rows 1..8 (top + 6 inner + bottom) inside 9 rows.
  assert.equal(bare[2], "│ 2     " + EDITOR_TOP + " ".repeat(6) + " │");
  for (let k = 3; k <= 7; k++) {
    assert.equal(bare[k], `│ ${k}     │ ` + "a".repeat(60) + " │" + " ".repeat(6) + " │");
  }
  // Last visible row is the cursor's row (the tail of the text), full width.
  assert.equal(bare[8], "│ 8     │ " + "a".repeat(40) + " " + " ".repeat(19) + " │" + " ".repeat(6) + " │");
  assert.equal(bare[9], "│ 9     " + EDITOR_BOTTOM + " ".repeat(6) + " │");
  // The scrolled-off head row (the first 60-char row) is not rendered.
  assert.equal(bare.filter((r) => r.includes("a".repeat(60))).length, 5);
  assert.equal(bare.length, 13); // occlusion, not push-down: 9 content + 4 chrome
});

test("comment box splices occluded rows ANSI-safely: no cut escapes, SGR state carried", () => {
  // A pending-marked, selected line styled with raw SGR runs; the fixed box
  // cuts mid-run, so the right sliver must re-open the carried SGR state.
  const lines = ["a".repeat(70), "second"];
  const h = makeCard({ lines });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 70 });
  h.card.handleInput("v");
  h.card.handleInput("c");
  const rows = h.card.render(80);
  const row = rows[1]; // content row 0 (the styled line) under the box top border
  assert.equal(visibleWidth(row), 80); // splice preserves the display width
  const tail = "a".repeat(6); // display cols 69..74 survive right of the box
  assert.equal(strip(row), "│ 1 " + PENDING_ICON + " " + "1 " + EDITOR_TOP + tail + " │");
  assert.ok(!strip(row).includes("\x1b"), "no broken escape sequences survive the splice");
  // The right sliver re-opens the carried SGR state before the surviving
  // text: both the inverse (7m) and underline (4m) attributes re-appear.
  const afterBox = row.slice(row.lastIndexOf("\u256e") + 1); // after the box's right border glyph
  const sliverCodes = afterBox.slice(0, afterBox.indexOf("aaaaaa"));
  assert.ok(sliverCodes.includes("\x1b[4m") && sliverCodes.includes("\x1b[7m"), `sliver carries SGR state, got: ${JSON.stringify(afterBox)}`);
  // The surviving text closes its underline attribute (no permanent bleed).
  assert.ok(afterBox.includes("\x1b[24m"));
});

test("comment box left sliver closes a cut SGR run before the border glyphs", () => {
  // Line 1 is fully underlined (pending); the box below the selection cuts
  // that row at content column 12 (content width - boxW clamp), inside the
  // underline run, so the left sliver would end with SGR 4 open. It must close
  // underline + inverse before the box border, or the border renders
  // underlined.
  const lines = ["a".repeat(41), "x".repeat(60), "c3", "d4"];
  const h = makeCard({ lines });
  h.pending.push({ startLine: 1, startCol: 0, endLine: 1, endCol: 60 });
  h.card.handleInput("$"); // cursor to end of line 0: selCol clamps the box left edge to 12
  h.card.handleInput("v");
  h.card.handleInput("c");
  const row = h.card.render(80)[2]; // box top border over content row 1
  const head = row.slice(0, row.indexOf("╭"));
  // head ends: ...UL_ON xxxxxxxxx + reset pair + the box's own border SGR.
  assert.ok(head.endsWith("\x1b[24m\x1b[27m" + FG_ON), `sliver closes SGR before the box, got: ${JSON.stringify(head.slice(-40))}`);
});

test("comment box flips above the selection near the viewport bottom", () => {
  const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const h = makeCard({ lines, rows: 12 });
  h.card.handleInput("G");
  h.card.handleInput("v");
  h.card.handleInput("c");
  const bare = h.card.render(80).map(strip);
  // Overlay budget: floor(0.8 * 12) = 9 rows -> 5 content rows + 4 chrome
  // (statusline + cmdline joined the borders); scrolled so line j (index 9)
  // is last: content shows lines f..j, rel 0..4.
  assert.equal(bare.length, 9);
  // selBottom 4 + 1 + boxH 3 > 5 -> flip above: box occupies content rows 1-3.
  // Fixed-width box (64) at width 80: left edge = gutter width (7), unclamped;
  // stripped row column = border 1 + pad 1 + 7 = 9.
  assert.equal(bare[2].indexOf("╭─ Comment"), 2 + 7);
  assert.equal(bare[4].indexOf("╰"), 2 + 7);
  // The selected line below the box is intact; the statusline shows the
  // comment badge above the cmdline hints.
  assert.ok(bare[5].startsWith("│ 10     j"));
  assert.ok(bare[6].startsWith("│ -- COMMENT --"));
});

test("comment box left edge clamps inside the right border", () => {
  const lines = ["x".repeat(60), "y", "z", "u", "v", "w"];
  const h = makeCard({ lines });
  h.card.handleInput("$");
  h.card.handleInput("v");
  h.card.handleInput("c");
  const width = 80;
  const bare = h.card.render(width).map(strip);
  const contentW = width - 4; // borders + padding each side; boxW fixed at 64
  const left = contentW - 64; // selCol clamps to contentW - boxW = 12
  assert.equal(bare[2].indexOf("╭─ Comment"), 2 + left);
  // The box ends at the last content column, inside the right padding.
  assert.ok(bare[2].endsWith("╮ │"));
});

// Pending styling -------------------------------------------------------------

test("pending markers: SGR 4 underline on the range text, warning icon+count marker", () => {
  const h = makeCard({ lines: ["abcd", "efgh"] });
  h.pending.push({ startLine: 0, startCol: 1, endLine: 0, endCol: 3 });
  const rows = h.card.render(40);
  const warned = h.fgCalls.filter((c) => c.token === "warning").map((c) => c.text);
  assert.ok(warned.includes(PENDING_ICON + " " + "1")); // gutter marker stays theme warning
  assert.ok(!warned.includes("bc"), "range text is no longer warning-highlighted");
  // The range text itself is underlined with raw SGR 4/24.
  assert.ok(rows.some((row) => row.includes("\x1b[4mbc\x1b[24m")), "range underlined via SGR 4");
});

test("pending underline spans multi-line ranges line by line", () => {
  const h = makeCard({ lines: ["abcd", "efgh", "ijkl"] });
  h.pending.push({ startLine: 0, startCol: 2, endLine: 1, endCol: 2 });
  const rows = h.card.render(40);
  assert.ok(rows.some((row) => row.includes("\x1b[4mcd\x1b[24m")), "start line: underline from startCol");
  assert.ok(rows.some((row) => row.includes("\x1b[4mef\x1b[24m")), "end line: underline to endCol");
});

// Gutter marker field -----------------------------------------------------------
// Start lines of pending drafts show the NF comment icon (U+F075) plus the
// number of drafts STARTING there; lines covered without a start show a dim
// vertical continuation bar; uncovered lines render a blank field of the same
// display width, so line numbers never shift when markers appear/disappear.

// The 3-cell pending-marker field of a stripped content row: "│" + padding
// column + line number (digits wide) + " " + field.
function fieldOf(bare: string, digits: number): string {
  return bare.slice(2 + digits + 1, 2 + digits + 1 + FIELD);
}

test("a pending line shows the icon plus the draft count in the gutter", () => {
  const h = makeCard({ lines: ["alpha", "beta", "gamma"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
  const bare = h.card.render(40).map(strip);
  assert.ok(bare[1].startsWith("│ 1 " + PENDING_ICON + " " + "1"), `icon + count on the pending line, got: ${JSON.stringify(bare[1])}`);
});

test("gutter count counts drafts STARTING on the line: two starts -> count 2", () => {
  const h = makeCard({ lines: ["alpha", "beta", "gamma"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 2 });
  h.pending.push({ startLine: 0, startCol: 3, endLine: 0, endCol: 5 });
  const bare = h.card.render(40).map(strip);
  assert.ok(bare[1].startsWith("│ 1 " + PENDING_ICON + " " + "2"), "two drafts starting on line 1 -> count 2");
  assert.ok(!bare[3].includes(PENDING_ICON), "unmarked line has no icon");
});

test("a covered line where no draft starts shows a dim centered continuation bar, not a count", () => {
  const h = makeCard({ lines: ["alpha", "beta", "gamma", "delta"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 2, endCol: 3 });
  const bare = h.card.render(40).map(strip);
  assert.equal(fieldOf(bare[1], 1), PENDING_ICON + " " + "1", "start line keeps icon + count");
  assert.equal(fieldOf(bare[2], 1), " " + CONTINUATION_MARK + " ", "continuation bar centered in the field");
  assert.equal(fieldOf(bare[3], 1), " " + CONTINUATION_MARK + " ", "end line is a continuation too");
  assert.ok(!bare[2].includes(PENDING_ICON) && !bare[3].includes(PENDING_ICON), "no icon on continuation lines");
  const dimmed = h.fgCalls.filter((c) => c.token === "dim").map((c) => c.text);
  assert.ok(dimmed.includes(CONTINUATION_MARK), "the bar is theme dim");
});

test("a line that both starts a draft and continues another shows the start count (start wins)", () => {
  const h = makeCard({ lines: ["a", "b", "c", "d", "e", "f"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 3, endCol: 0 }); // A: lines 1-4
  h.pending.push({ startLine: 2, startCol: 0, endLine: 5, endCol: 0 }); // B: lines 3-6
  const bare = h.card.render(40).map(strip);
  assert.equal(fieldOf(bare[1], 1), PENDING_ICON + " " + "1", "line 1: A starts");
  assert.equal(fieldOf(bare[2], 1), " " + CONTINUATION_MARK + " ", "line 2: A continues");
  assert.equal(fieldOf(bare[3], 1), PENDING_ICON + " " + "1", "line 3: B starts (A continues: start wins)");
  assert.equal(fieldOf(bare[4], 1), " " + CONTINUATION_MARK + " ", "line 4: both continue");
  assert.equal(fieldOf(bare[5], 1), " " + CONTINUATION_MARK + " ", "line 5: B continues");
  assert.equal(fieldOf(bare[6], 1), " " + CONTINUATION_MARK + " ", "line 6: B continues");
});

test("gutter start-counts sum to the pending count across overlapping drafts", () => {
  // The invariant from spec section 3: the sum of all gutter counts equals
  // the title bar's (N) pending count, no matter how the drafts overlap.
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const h = makeCard({ lines });
  const ranges: Range[] = [
    { startLine: 0, startCol: 0, endLine: 3, endCol: 5 },
    { startLine: 0, startCol: 7, endLine: 0, endCol: 9 },
    { startLine: 2, startCol: 0, endLine: 5, endCol: 5 },
    { startLine: 2, startCol: 6, endLine: 2, endCol: 9 },
    { startLine: 4, startCol: 0, endLine: 9, endCol: 6 },
    { startLine: 7, startCol: 0, endLine: 8, endCol: 2 },
  ];
  for (const r of ranges) h.pending.push(r);
  const bare = h.card.render(60).map(strip);
  const digits = String(lines.length).length;
  let sum = 0;
  for (let k = 0; k < lines.length; k++) {
    const field = fieldOf(bare[1 + k], digits);
    if (field.includes(PENDING_ICON)) sum += field[2] === "+" ? 10 : Number(field[2]);
  }
  assert.equal(sum, ranges.length);
});

test("more than 9 drafts starting on a line render as icon + +", () => {
  const h = makeCard({ lines: ["alpha"] });
  for (let i = 0; i < 10; i++) {
    h.pending.push({ startLine: 0, startCol: i, endLine: 0, endCol: i + 1 });
  }
  const bare = h.card.render(40).map(strip);
  assert.ok(bare[1].startsWith("│ 1 " + PENDING_ICON + " " + "+"), "count 10 renders as icon plus plus");
});

test("the marker field keeps the gutter constant-width when markers appear", () => {
  const lines = ["alpha", "beta", "gamma"];
  const plain = makeCard({ lines }).card.render(40).map(strip);
  const h = makeCard({ lines });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
  const marked = h.card.render(40).map(strip);
  // Unmarked rows render byte-identically and every row keeps its width:
  // only the marked line's field cells change.
  assert.equal(marked[2], plain[2]);
  assert.equal(visibleWidth(marked[1]), visibleWidth(plain[1]));
  assert.equal(visibleWidth(marked[2]), visibleWidth(plain[2]));
  assert.equal(gutterWidth(3), 1 + FIELD + 2);
});

test("the marker field uses the theme warning color; blank fields stay unstyled", () => {
  const h = makeCard({ lines: ["alpha", "beta"] });
  h.pending.push({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 });
  h.card.render(40);
  const warned = h.fgCalls.filter((c) => c.token === "warning").map((c) => c.text);
  assert.deepEqual(warned, [PENDING_ICON + " " + "1"]); // only line 1's field is styled
});

// Target emphasis (spec section 2) ---------------------------------------------
// Normal mode only: the cycle target's range paints theme warning fg + bold +
// underline; the other stack members covering the cursor dim their underline
// (SGR 2); pending ranges off the cursor keep plain SGR 4. Visual and comment
// modes never emphasize.

const BOLD_ON = "\x1b[1m";
const DIM_ON = "\x1b[2m";
const INTENSITY_OFF = "\x1b[22m"; // complement of both bold (SGR 1) and dim (SGR 2)
const UNDERLINE_ON = "\x1b[4m"; // raw SGR codes the card paints pending ranges with
const UNDERLINE_OFF = "\x1b[24m";

// Two stacked drafts on "abcdef": the newer covers cols 0-2 (display span
// "ab"), the older cols 2-4 (display span "cd", end-exclusive); the cursor at
// col 2 is hit-covered by both (hit testing is end-inclusive).
function makeStack(): CardHarness {
  const h = makeCard({ lines: ["abcdef", "beta"] });
  const older = { startLine: 0, startCol: 2, endLine: 0, endCol: 4 };
  const newer = { startLine: 0, startCol: 0, endLine: 0, endCol: 2 };
  h.pending.push(older, newer);
  h.drafts.push({ token: "[a.ts:3-5]", range: older, comment: "older" });
  h.drafts.push({ token: "[a.ts:1-3 ~2]", range: newer, comment: "newer" });
  h.card.handleInput("l");
  h.card.handleInput("l"); // cursor col 2, inside both ranges
  // Preview off: with only 2 content rows the preview box cannot fit below
  // the cursor line and would occlude the emphasized spans under test.
  h.card.handleInput("p");
  return h;
}

test("target emphasis: cycle target warning+bold+underline, other stack member dim underline", () => {
  const h = makeStack();
  const row = h.card.render(60)[1];
  // Target (newest draft, "ab"): the theme warning fg wraps bold + underline.
  assert.ok(row.includes(FG_ON + BOLD_ON + UNDERLINE_ON + "ab" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF), "target span is warning fg + bold + underline");
  // Non-target stack member ("d", the older draft's display span tail): dim
  // underline, no theme wrap. (Its "c" cell composes with the cursor's
  // inverse instead.)
  assert.ok(row.includes(DIM_ON + UNDERLINE_ON + "d" + INTENSITY_OFF + UNDERLINE_OFF), "stack member under the cursor dims its underline");
  // The warning token styles exactly the bold+underline composite.
  assert.ok(h.fgCalls.some((c) => c.token === "warning" && c.text === BOLD_ON + UNDERLINE_ON + "ab" + INTENSITY_OFF + UNDERLINE_OFF));
});

test("Tab moves the emphasis to the next stack member", () => {
  const h = makeStack();
  h.card.handleInput("\t"); // ordinal 1: the older draft becomes the target
  const row = h.card.render(60)[1];
  assert.ok(row.includes(FG_ON + BOLD_ON + UNDERLINE_ON + "d" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF), "new target span warning+bold+underline");
  assert.ok(row.includes(DIM_ON + UNDERLINE_ON + "ab" + INTENSITY_OFF + UNDERLINE_OFF), "previous target dims to underline");
});

test("pending ranges off the cursor keep plain underline (no emphasis)", () => {
  const h = makeCard({ lines: ["abcd", "beta"] });
  const r = { startLine: 0, startCol: 1, endLine: 0, endCol: 3 };
  h.pending.push(r);
  h.drafts.push({ token: "[a.ts:2-4]", range: r, comment: "note" });
  h.card.handleInput("j"); // cursor to line 1, off the range
  const row = h.card.render(60)[1];
  assert.ok(row.includes(UNDERLINE_ON + "bc" + UNDERLINE_OFF), "plain SGR 4 underline");
  assert.ok(!row.includes(BOLD_ON) && !row.includes(DIM_ON), "no bold or dim emphasis");
});

test("visual mode: no target emphasis, selection inverse unchanged", () => {
  const h = makeStack();
  h.card.handleInput("v"); // visual-char anchored at col 2
  h.card.handleInput("l"); // selection cols 2-3
  const row = h.card.render(60)[1];
  assert.ok(!row.includes(BOLD_ON) && !row.includes(DIM_ON), "no target emphasis in visual mode");
  assert.ok(row.includes("\x1b[7m"), "selection still inverse");
  assert.ok(row.includes(UNDERLINE_ON + "ab" + UNDERLINE_OFF), "pending underline stays plain");
});

test("comment mode: no target emphasis", () => {
  const h = makeStack();
  h.card.handleInput("c"); // opens the editor for the cycle target
  for (const row of h.card.render(60)) {
    assert.ok(!row.includes(BOLD_ON) && !row.includes(DIM_ON), "no target emphasis in comment mode");
  }
});

// Regression: overlapping stack ranges must not nest the non-target dim
// inside the target wrap - SGR 2 dims the warning fg into invisibility on
// dark terminals. Only the strongest emphasis paints per segment.
test("overlapping stack ranges: target segment carries no dim", () => {
  const h = makeCard({ lines: ["abcdef", "beta"] });
  const older = { startLine: 0, startCol: 1, endLine: 0, endCol: 5 }; // bcde
  const newer = { startLine: 0, startCol: 0, endLine: 0, endCol: 3 }; // abc
  h.pending.push(older, newer);
  h.drafts.push({ token: "[a.ts:2-6]", range: older, comment: "older" });
  h.drafts.push({ token: "[a.ts:1-4]", range: newer, comment: "newer" });
  h.card.handleInput("l"); // cursor col 1: covered by both
  h.card.handleInput("p"); // preview off: the box would occlude the spans
  const row = h.card.render(60)[1];
  // Overlap cells "b" and "c": target only (warning fg + bold + underline),
  // no dim inside; the cursor cell "c" composes inverse on top of target.
  assert.ok(row.includes(FG_ON + BOLD_ON + UNDERLINE_ON + "c" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF), "overlap segment is pure target");
  assert.ok(row.includes("\x1b[7m" + FG_ON + BOLD_ON + UNDERLINE_ON + "b" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF + "\x1b[27m"), "cursor cell = inverse over pure target");
  assert.ok(!row.includes(BOLD_ON + UNDERLINE_ON + DIM_ON), "no dim nested inside any target wrap");
  // Older-only tail "de": dim underline.
  assert.ok(row.includes(DIM_ON + UNDERLINE_ON + "de" + INTENSITY_OFF + UNDERLINE_OFF), "non-target-only segment dims");
  // Newer-only head "a": target without dim.
  assert.ok(row.includes(FG_ON + BOLD_ON + UNDERLINE_ON + "a" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF), "target-only segment");
});

test("cursor cell composes with target emphasis and stays a single inverse cell", () => {
  const h = makeCard({ lines: ["abcdef", "beta"] });
  const r = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.pending.push(r);
  h.drafts.push({ token: "[a.ts:1-6]", range: r, comment: "note" });
  h.card.handleInput("l");
  h.card.handleInput("l"); // cursor col 2, inside the target range
  h.card.handleInput("p"); // preview off: keeps the cursor row unoccluded
  const row = h.card.render(60)[1];
  // Pending spans paint before the cursor cell, so the inverse cell wraps
  // the target-styled "c": the cursor stays visible over the emphasized text.
  assert.ok(row.includes("\x1b[7m" + FG_ON + BOLD_ON + UNDERLINE_ON + "c" + INTENSITY_OFF + UNDERLINE_OFF + FG_OFF + "\x1b[27m"), "inverse cursor cell over target-styled char");
});

// Task 3 seams ----------------------------------------------------------------

test("update and delete effects still dispatch through the Task 3 seams", () => {
  const h = makeCard({ lines: ["abcd", "efgh"] });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 4 };
  h.drafts.push({ token: "[src/a.ts:1]", range, comment: "old" });
  h.pending.push(range);
  // Edit: c opens the prefilled box, submit updates the draft in place.
  h.card.handleInput("c");
  h.card.handleInput("!");
  h.card.handleInput("\r");
  assert.deepEqual(h.calls.update, [["[src/a.ts:1]", "old!"]]);
  assert.deepEqual(h.calls.annotate, []);
  // Delete: x on the same pending line removes the draft.
  h.card.handleInput("x");
  assert.deepEqual(h.calls.deleted, ["[src/a.ts:1]"]);
  // Close still dispatches from normal mode.
  h.card.handleInput("q");
  assert.equal(h.calls.closed, 1);
});

// Hover preview (normal mode, p toggle) ----------------------------------------
// In normal mode with previewOn, a cursor resting on a pending line renders a
// read-only Comment box for that draft, placed like the comment-mode box and
// occluding (not pushing down) content rows. p toggles it off and on.

test("hover preview: cursor on a pending line shows a read-only Comment box below it", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  const width = 40;
  const bare = h.card.render(width).map(strip);
  const tail = " ".repeat(width - 4 - 19); // gutter 6 + box 13
  // Box opens one row below the cursor row (row 0), left edge at the draft's
  // start display column (gutter 5 + col 0): same chrome and placement as
  // the comment-mode box.
  assert.equal(bare[2], "│ 2     ╭─ Comment ─╮" + tail + " │");
  assert.equal(bare[3], "│ 3     │ note      │" + tail + " │");
  assert.equal(bare[4], "│ 4     ╰───────────╯" + tail + " │");
  // Occlusion, not push-down: 5 content rows + 4 chrome rows, unchanged.
  assert.equal(bare.length, 9);
});

test("hover preview: p hides it and p brings it back", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  h.card.handleInput("p");
  let bare = h.card.render(40).map(strip);
  for (const row of bare) assert.ok(!row.includes("Comment"), "preview hidden after p");
  h.card.handleInput("p");
  bare = h.card.render(40).map(strip);
  assert.ok(bare[2].includes("╭─ Comment"), "preview returns after p again");
});

test("hover preview: cursor off pending lines shows nothing", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  h.card.handleInput("j"); // cursor onto line 1, no draft covers it
  const bare = h.card.render(40).map(strip);
  for (const row of bare) assert.ok(!row.includes("Comment"), "no box off pending lines");
  assert.ok(strip(bare[2]).startsWith("│ 2     beta")); // content row intact
});

test("hover preview: cursor past the draft's end column shows nothing", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 3 }; // covers "alp"
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  h.card.handleInput("l"); // cursor col 1: inside
  assert.ok(h.card.render(40).map(strip)[2].includes("╭─ Comment"));
  h.card.handleInput("l");
  h.card.handleInput("l"); // cursor col 3 = endCol: still inside (end inclusive)
  assert.ok(h.card.render(40).map(strip)[2].includes("╭─ Comment"));
  h.card.handleInput("l"); // cursor col 4: past endCol 3
  const bare = h.card.render(40).map(strip);
  for (const row of bare) assert.ok(!row.includes("Comment"), "no box past the end column");
});

test("hover preview renders no emulated cursor (read-only)", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  const rows = h.card.render(40);
  const boxRow = rows.find((r) => strip(r).includes("│ note")) as string;
  assert.ok(boxRow, "preview box row present");
  assert.ok(!boxRow.includes("\x1b[7m"), "read-only preview box has no cursor cell");
});

test("hover preview: comments longer than 6 box rows are capped", () => {
  const lines = Array.from({ length: 8 }, (_, i) => `ln ${i}`);
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 2 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "c0\nc1\nc2\nc3\nc4\nc5\nc6" });
  h.pending.push(range);
  const bare = h.card.render(40).map(strip);
  // 6 box rows total including borders: top + 4 comment lines + bottom.
  assert.ok(bare[2].includes("╭─ Comment"));
  assert.ok(bare[3].includes("│ c0"));
  assert.ok(bare[6].includes("│ c3"));
  assert.ok(bare[7].includes("╰"));
  for (const row of bare) assert.ok(!row.includes("c4"), "comment capped at 6 box rows");
});

test("hover preview: multi-line draft anchors to the draft's start column, not the cursor", () => {
  const lines = ["lorem", "ipsum", "dolor", "sit", "amet"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 2, endLine: 1, endCol: 1 };
  h.drafts.push({ token: "[a.ts:1-2]", range, comment: "note" });
  h.pending.push(range);
  let bare = h.card.render(40).map(strip);
  // Column-precise targeting: cursor col 0 is before the draft's startCol 2,
  // so no preview shows until the cursor moves inside the range.
  for (const row of bare) assert.ok(!row.includes("Comment"), "no preview before the start column");
  h.card.handleInput("l");
  h.card.handleInput("l"); // cursor to (0, 2), now inside the draft
  bare = h.card.render(40).map(strip);
  // Left edge = border 1 + pad 1 + gutter 6 + draft startCol 2 (not the cursor col 2).
  assert.equal(bare[2].indexOf("╭─ Comment"), 2 + 6 + 2);
});

test("hover preview: c on the pending line replaces it with the pre-filled editor", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "prefill" });
  h.pending.push(range);
  h.card.handleInput("c"); // edit flow: comment mode, exactly one box
  let bare = h.card.render(40).map(strip);
  assert.equal(bare.filter((r) => r.includes("╭─ Comment")).length, 1);
  assert.ok(bare.some((r) => r.includes("│ prefill")));
  assert.ok(bare[bare.length - 3].startsWith("│ -- COMMENT --"));
  // Esc back to normal: the read-only preview is shown again.
  h.card.handleInput("\x1b");
  bare = h.card.render(40).map(strip);
  assert.ok(bare[2].includes("╭─ Comment"));
});

test("preview shows the cycle target's comment with a (i/n) title on stacked drafts", () => {
  const lines = ["abcdef", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const older = { startLine: 0, startCol: 2, endLine: 0, endCol: 4 };
  const newer = { startLine: 0, startCol: 0, endLine: 0, endCol: 2 };
  h.pending.push(older, newer);
  h.drafts.push({ token: "[a.ts:3-5]", range: older, comment: "older note" });
  h.drafts.push({ token: "[a.ts:1-3 ~2]", range: newer, comment: "newer note" });
  h.card.handleInput("l");
  h.card.handleInput("l"); // cursor col 2: stack [newer, older]
  let bare = h.card.render(60).map(strip);
  assert.ok(bare[2].includes("╭─ Comment (1/2) ─╮"), `title carries 1/2, got: ${JSON.stringify(bare[2])}`);
  assert.ok(bare[3].includes("│ newer note"), "box shows the target's comment");
  h.card.handleInput("\t"); // cycle: the older draft becomes the target
  bare = h.card.render(60).map(strip);
  assert.ok(bare[2].includes("╭─ Comment (2/2) ─╮"), "title advances to 2/2");
  assert.ok(bare[3].includes("│ older note"), "box shows the newly targeted comment");
});

test("preview on a stack of 1 keeps the plain Comment title", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const h = makeCard({ lines });
  const range = { startLine: 0, startCol: 0, endLine: 0, endCol: 5 };
  h.drafts.push({ token: "[a.ts:1]", range, comment: "note" });
  h.pending.push(range);
  const bare = h.card.render(40).map(strip);
  assert.ok(bare[2].includes("╭─ Comment ─╮"), "plain title");
  for (const row of bare) assert.ok(!row.includes("(1/"), "no positional indicator on a lone draft");
});

// Kitty keyboard protocol normalization ---------------------------------------

// normalizeKeyRepeat -------------------------------------------------------
// Under the kitty keyboard protocol (flags 7 enabled by pi-tui) functional
// keys repeat as event-type-2 sequences ("\x1b[1;1:2A") instead of the
// press form ("\x1b[A") the reducer matches; normalizeKeyRepeat rewrites
// them so held arrow/PgUp/PgDn keys scroll.

test("normalizeKeyRepeat rewrites kitty repeat sequences to press equivalents", () => {
  assert.equal(normalizeKeyRepeat("\x1b[1;1:2A"), "\x1b[A"); // up
  assert.equal(normalizeKeyRepeat("\x1b[1;1:2B"), "\x1b[B"); // down
  assert.equal(normalizeKeyRepeat("\x1b[1;1:2D"), "\x1b[D"); // left
  assert.equal(normalizeKeyRepeat("\x1b[1;1:2C"), "\x1b[C"); // right
  assert.equal(normalizeKeyRepeat("\x1b[5;1:2~"), "\x1b[5~"); // PgUp
  assert.equal(normalizeKeyRepeat("\x1b[6;1:2~"), "\x1b[6~"); // PgDn
  assert.equal(normalizeKeyRepeat("\x1b[99;1:2u"), "\x1b[99u"); // CSI-u 'c'
});

test("normalizeKeyRepeat keeps real modifiers and strips only the event field", () => {
  assert.equal(normalizeKeyRepeat("\x1b[1;2:2A"), "\x1b[1;2A"); // shift+up
  assert.equal(normalizeKeyRepeat("\x1b[5;5:2~"), "\x1b[5;5~"); // ctrl+PgUp
});

test("normalizeKeyRepeat passes presses, plain text, and bracketed paste through", () => {
  assert.equal(normalizeKeyRepeat("\x1b[A"), "\x1b[A");
  assert.equal(normalizeKeyRepeat("\x1b[200~"), "\x1b[200~");
  assert.equal(normalizeKeyRepeat("\x1b[201~"), "\x1b[201~");
  assert.equal(normalizeKeyRepeat("h"), "h");
});

test("handleInput normalizes kitty repeats so held arrow keys move and scroll", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  const h = makeCard({ lines, rows: 24 });
  for (let i = 0; i < 17; i++) h.card.handleInput("\x1b[1;1:2B"); // held down arrow
  // 17 downs with 15 content rows: scrollTop 3, first visible line is 4
  // (1-based, right-aligned in the 2-digit gutter).
  assert.ok(h.card.render(40).map(strip)[1].startsWith("│  4"), "held repeat-form arrow scrolled the viewport");
});

test("kitty CSI-u ctrl+j and shift+enter insert a newline in comment mode", () => {
  const h = makeCard({ lines: ["alpha", "beta"] });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("hello");
  h.card.handleInput("\x1b[106;5u"); // kitty ctrl+j
  h.card.handleInput("world");
  h.card.handleInput("\r");
  assert.equal(h.calls.annotate[0].comment, "hello\nworld");

  const h2 = makeCard({ lines: ["alpha", "beta"] });
  h2.card.handleInput("v");
  h2.card.handleInput("c");
  h2.card.handleInput("a");
  h2.card.handleInput("\x1b[13;2u"); // kitty shift+enter
  h2.card.handleInput("b");
  h2.card.handleInput("\r");
  assert.equal(h2.calls.annotate[0].comment, "a\nb");
});


// sliceWindow ---------------------------------------------------------------

test("sliceWindow: wide char straddling the left cut becomes a placeholder space", () => {
  // 中 1 covers cells 0-1; cutting at 1 straddles it. The placeholder keeps
  // the slice aligned with the source's display columns.
  assert.equal(sliceWindow("中".repeat(10), 1, 6), " 中中"); // placeholder + 2 whole 中; 中 5 at 6-7 straddles the right cut and is dropped
  assert.equal(sliceWindow("中".repeat(10), 2, 6), "中中中"); // no straddle
  assert.equal(sliceWindow("abc", 0, 6), "abc"); // short row, no straddle
});

test("comment box borders stay column-aligned when a cut straddles a wide char", () => {
  const h = makeCard({ lines: ["h", "b".repeat(50), "中".repeat(40), "c".repeat(50), "tail"] });
  h.card.render(120);
  h.card.handleInput("j");
  for (let i = 0; i < 11; i++) h.card.handleInput("l");
  h.card.handleInput("v");
  h.card.handleInput("l"); // select two b's
  h.card.handleInput("c");
  const raw = h.card.render(120);
  const rows = raw.map(strip);
  // The box overlays rows 3-5 (CJK line, ASCII line, short line). Its left
  // border must sit in the same DISPLAY column on every row: panel border
  // (1) + padding (1) + gutter (6) + anchor col 11 = 19. (String indices
  // differ on the CJK row - measure display columns.)
  const colOf = (row: string, ch: string) => {
    const i = row.indexOf(ch, 1);
    return i < 0 ? i : visibleWidth(row.slice(0, i));
  };
  const top = colOf(rows[3], "╭");
  const mid = colOf(rows[4], "│");
  const bot = colOf(rows[5], "╰");
  assert.equal(top, 19, `top border column, row: ${JSON.stringify(rows[3])}`);
  assert.equal(mid, 19, `middle border column, row: ${JSON.stringify(rows[4])}`);
  assert.equal(bot, 19, `bottom border column, row: ${JSON.stringify(rows[5])}`);
  for (const [i, r] of raw.entries()) assert.equal(visibleWidth(r), 120, `row ${i} width`);
});

// Search highlight and wiring -------------------------------------------------
//
// Task 5: matches of the live query (search mode) or lastSearch style as
// theme accent fg + SGR 1 bold ("match"), composing with pending underlines
// and losing to inverse selections; the bottom area switches to the / input
// in search mode, shows the [rank/total] segment, and renders transient
// reducer messages right-aligned for exactly one keypress.

// The match composite over "foo": accent fg wraps SGR 1 bold. FG_ON+BOLD_ON
// adjacency is unique to match spans in a rendered row (cursor/selection is
// raw inverse, pending is raw SGR 4/2), so it also serves as a position
// anchor for column assertions.
const MATCH_FOO = FG_ON + BOLD_ON + "foo" + INTENSITY_OFF + FG_OFF;

// Runs "foo" through the real search flow (/foo<Enter>): lastSearch stored,
// the incremental jump parks the cursor on the first match's first cell.
function searchFoo(h: CardHarness): CardHarness {
  for (const key of ["/", "f", "o", "o", "\r"]) h.card.handleInput(key);
  return h;
}

test("highlight: matches of lastSearch are styled on tabbed and CJK lines", () => {
  const h = searchFoo(makeCard({ lines: ["\tfoo bar", "\u4e2dfoo"] }));
  h.card.handleInput("h"); // park the cursor on the tab cell, off the match
  const rows = h.card.render(80);
  assert.ok(rows[1].includes(MATCH_FOO), `line 0 match styled, got: ${JSON.stringify(strip(rows[1]))}`);
  assert.ok(rows[2].includes(MATCH_FOO), `line 1 match styled, got: ${JSON.stringify(strip(rows[2]))}`);
  // Column proof: the styled wrap starts at the match's DISPLAY column -
  // col 4 on the tabbed line (tab -> stop 4) and col 2 on the CJK line (the
  // wide char counts 2) - behind the frame prefix (2) and the 6-wide gutter.
  const startCol = (row: string) => visibleWidth(row.slice(0, row.indexOf(FG_ON + BOLD_ON))) - 2 - gutterWidth(2);
  assert.equal(startCol(rows[1]), 4, `match at display col 4 on the tabbed line, got: ${JSON.stringify(strip(rows[1]))}`);
  assert.equal(startCol(rows[2]), 2, `match at display col 2 on the CJK line, got: ${JSON.stringify(strip(rows[2]))}`);
});

test("highlight: match composes with pending underline, loses to inverse selection", () => {
  const h = searchFoo(makeCard({ lines: ["\tfoo bar", "beta"] }));
  const r = { startLine: 0, startCol: 1, endLine: 0, endCol: 4 }; // exactly the match
  h.pending.push(r);
  h.drafts.push({ token: "[a.ts:2-5]", range: r, comment: "note" });
  h.card.handleInput("j"); // cursor line 1, off the draft: plain underline
  const row = h.card.render(80)[1];
  assert.ok(
    row.includes(UNDERLINE_ON + MATCH_FOO + UNDERLINE_OFF),
    `pending underline and match style wrap the same segment, got: ${JSON.stringify(strip(row))}`,
  );
  // Selection over the match: the segment renders inverse (selection wins).
  h.pending.pop();
  h.drafts.pop();
  h.card.handleInput("k"); // cursor back to line 0 col 1, the match start
  h.card.handleInput("v"); // anchor there
  h.card.handleInput("l");
  h.card.handleInput("l");
  h.card.handleInput("l"); // selection [1,5) covers the match; the cursor cell
  // parks past its end so the match renders as ONE segment (no cell split).
  const selRow = h.card.render(80)[1];
  assert.ok(
    selRow.includes("\x1b[7m" + MATCH_FOO + "\x1b[27m"),
    `the selected match renders inverse over the match style, got: ${JSON.stringify(strip(selRow))}`,
  );
});

test("highlight: persists in comment mode (hlsearch)", () => {
  const h = searchFoo(makeCard({ lines: ["foo", "a", "b", "c", "d", "foo"] }));
  h.card.handleInput("v");
  h.card.handleInput("c"); // comment mode over the line-0 selection
  const rows = h.card.render(80);
  // The box floats below the selection start (line 0); the second match on
  // line 5 stays visible and keeps the match style.
  assert.ok(rows[6].includes(MATCH_FOO), `match style survives into comment mode, got: ${JSON.stringify(strip(rows[6]))}`);
});

test("wiring: search mode renders the cmdline input and the [rank/total] segment", () => {
  const h = makeCard({ lines: ["foo", "bar foo"] });
  for (const key of ["/", "f", "o", "o"]) h.card.handleInput(key); // typing, not submitted
  const rows = h.card.render(80);
  const bare = rows.map(strip);
  // Statusline: search badge with the rank segment (cursor on match 1 of 2).
  assert.ok(bare[3].includes("-- SEARCH --"), `search badge, got: ${bare[3]}`);
  assert.ok(bare[3].includes("[1/2]"), `rank segment, got: ${bare[3]}`);
  // Cmdline: the / input with the query and the emulated inverse cursor.
  assert.ok(bare[4].startsWith("│ /foo"), `cmdline input, got: ${bare[4]}`);
  assert.ok(rows[4].includes("\x1b[7m \x1b[27m"), "inverse cmdline cursor cell");
});

test("wiring: a transient message renders right-aligned and clears on the next key", () => {
  const h = searchFoo(makeCard({ lines: ["foo", "x foo"] })); // cursor on match 1
  h.card.handleInput("n"); // match 2, no wrap
  h.card.handleInput("n"); // wraps to match 1: the reducer sets the wrap message
  const bare = h.card.render(80).map(strip);
  assert.ok(bare[4].includes("search hit BOTTOM, continuing at TOP"), `wrap message shown, got: ${bare[4]}`);
  assert.ok(bare[4].endsWith("search hit BOTTOM, continuing at TOP │"), `message right-aligned, got: ${bare[4]}`);
  h.card.handleInput("l"); // any next key drops the message
  const after = h.card.render(80).map(strip);
  assert.ok(!after[4].includes("search hit BOTTOM"), `message cleared, got: ${after[4]}`);
  assert.ok(after[4].includes("hjkl move"), "hints restored");
});
