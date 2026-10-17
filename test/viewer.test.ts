import { test } from "node:test";
import assert from "node:assert/strict";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";

import type { Range, VisualMode } from "../src/selection.ts";
import type { PendingDraft } from "../src/viewer-state.ts";
import { AnnotateCard, gutterWidth, rawColToDisplayCol, tabExpanded } from "../src/viewer.ts";

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

test("gutterWidth covers the widest line number, marker column and separators", () => {
  assert.equal(gutterWidth(1), 4); // "1" + " " + marker + " "
  assert.equal(gutterWidth(9), 4); // single-digit numbers
  assert.equal(gutterWidth(10), 5); // two-digit numbers
  assert.equal(gutterWidth(100), 6); // three-digit numbers
  assert.equal(gutterWidth(0), 4); // degenerate: still one digit wide
});

test("gutterWidth digits track the line count magnitude", () => {
  assert.equal(gutterWidth(99), 5);
  assert.equal(gutterWidth(9999), 7); // four digits + 3
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

function makeCard(opts: { lines: string[]; path?: string; cwd?: string; rows?: number }): CardHarness {
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
  const tui = { terminal: { rows: opts.rows ?? 24 } } as unknown as TUI;
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

test("render frames the card: embedded title, footer row, bottom border, uniform width", () => {
  const h = makeCard({ lines: ["alpha", "beta"] });
  const width = 80; // the NORMAL badge (13) + hints (65) truncate slightly at inner 78
  const rows = h.card.render(width);
  const bare = rows.map(strip);
  assert.equal(rows.length, 5); // top border + 2 content rows + footer + bottom border
  assert.equal(bare[0], "╭─ Annotate: src/a.ts " + "─".repeat(57) + "╮");
  assert.equal(bare[1], "│1   alpha" + " ".repeat(69) + "│");
  assert.ok(bare[3].startsWith("│-- NORMAL --  hjkl move"));
  assert.ok(bare[3].endsWith("│"));
  assert.equal(bare[4], "╰" + "─".repeat(78) + "╯");
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

test("footer hints follow the mode: badge in accent, hints in dim", () => {
  // Width 84 leaves room for the NORMAL badge (13) + full fixed hint string
  // (65) inside inner 82 (no truncation); the other modes fit at width 80.
  const normal = makeCard({ lines: ["alpha", "beta"] });
  let bare = normal.card.render(84).map(strip);
  assert.ok(bare[3].startsWith("│-- NORMAL --  hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close"));
  assert.ok(normal.fgCalls.some((c) => c.token === "accent" && c.text === "-- NORMAL --"));
  assert.ok(normal.fgCalls.some((c) => c.token === "dim" && c.text === "hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close"));

  const visual = makeCard({ lines: ["alpha", "beta"] });
  visual.card.handleInput("v");
  bare = visual.card.render(80).map(strip);
  assert.ok(bare[3].startsWith("│-- VISUAL --"));
  assert.ok(visual.fgCalls.some((c) => c.token === "accent" && c.text === "-- VISUAL --"));
  assert.ok(visual.fgCalls.some((c) => c.token === "dim" && c.text === "hjkl extend  o swap  c comment  Esc cancel"));

  const vline = makeCard({ lines: ["alpha", "beta"] });
  vline.card.handleInput("V");
  bare = vline.card.render(80).map(strip);
  assert.ok(bare[3].startsWith("│-- VISUAL LINE --"));

  const comment = makeCard({ lines: ["alpha", "beta"] });
  comment.card.handleInput("v");
  comment.card.handleInput("c");
  bare = comment.card.render(80).map(strip);
  assert.ok(bare[bare.length - 2].startsWith("│-- COMMENT --"));
  assert.ok(bare[bare.length - 2].includes("Enter submit  ctrl+j newline  Esc cancel"));
});

// Geometry --------------------------------------------------------------------

test("content rows clip to the inner width (border takes 2 columns)", () => {
  const h = makeCard({ lines: ["x".repeat(60)] });
  const width = 30;
  const bare = h.card.render(width).map(strip);
  assert.equal(bare.length, 4);
  assert.equal(bare[1].length, width);
  assert.ok(bare[1].startsWith("│1   xx"));
  assert.ok(bare[1].includes("...")); // clipped by the inner-width budget
});

test("viewport budget subtracts border (2) and footer (1) rows", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const tall = makeCard({ lines, rows: 24 });
  // Overlay clips to floor(0.8 * 24) = 19 rows; 19 - 3 chrome = 16 content.
  assert.equal(tall.card.render(30).length, 19);
  const huge = makeCard({ lines, rows: 100 });
  assert.equal(huge.card.render(30).length, 33); // capped at MAX_VIEWPORT_ROWS (30)
  const tiny = makeCard({ lines, rows: 2 });
  assert.equal(tiny.card.render(30).length, 4); // MIN_VIEWPORT_ROWS (1) + chrome
});

test("the floating comment box does not consume viewport budget", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const h = makeCard({ lines, rows: 24 });
  const before = h.card.render(30).length;
  h.card.handleInput("v");
  h.card.handleInput("c");
  assert.equal(h.card.render(30).length, before);
});

// Floating comment box --------------------------------------------------------
//
// The comment EDITOR box is fixed-width: min(inner, 64) columns, never
// resizing while typing; long text soft-wraps and the box caps at 8 rows
// (6 content rows), keeping the cursor's row visible. The read-only preview
// box stays content-sized with a 6-row cap.

// The editor box at width 80: inner 78, boxW 64, gutter 4 -> left edge 4;
// top border "╭─ Comment " + 52 dashes + "╮"; right sliver 78 - 4 - 64 = 10.
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
  // the first 4 columns of the occluded row (its gutter) stay visible.
  assert.equal(bare[2], "│2   " + EDITOR_TOP + " ".repeat(10) + "│");
  // Inner row: emulated cursor renders as an inverse space on the empty box.
  assert.equal(bare[3], "│3   │" + " ".repeat(62) + "│" + " ".repeat(10) + "│");
  assert.equal(bare[4], "│4   " + EDITOR_BOTTOM + " ".repeat(10) + "│");
  // No push-down: 5 content rows + 3 chrome rows, unchanged by the box.
  assert.equal(bare.length, 8);
  assert.ok(bare[6].startsWith("│-- COMMENT --"));
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
  assert.equal(after[3], "│3   │hi " + " ".repeat(59) + "│" + " ".repeat(10) + "│");
  // The cursor cell under the just-typed text is the inverse space after it.
  const raw = h.card.render(80);
  assert.ok(raw[3].includes("\x1b[7m \x1b[27m"), "emulated inverse cursor at end of text");
});

test("comment text soft-wraps at the box's inner content width", () => {
  const lines = ["abc", "def", "ghi", "jkl", "mno"];
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("b".repeat(70)); // wrap width 62 -> 62 + 8
  const bare = h.card.render(80).map(strip);
  assert.equal(bare[2], "│2   " + EDITOR_TOP + " ".repeat(10) + "│");
  assert.equal(bare[3], "│3   │" + "b".repeat(62) + "│" + " ".repeat(10) + "│");
  assert.equal(bare[4], "│4   │" + "b".repeat(8) + " " + " ".repeat(53) + "│" + " ".repeat(10) + "│");
  assert.equal(bare[5], "│5   " + EDITOR_BOTTOM + " ".repeat(10) + "│");
});

test("comment box caps at 8 rows and keeps the cursor's row visible", () => {
  const lines = Array.from({ length: 9 }, (_, i) => `pad${i}`);
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("a".repeat(400)); // wrap width 62 -> 7 rows of 62/62/62/62/62/62/28
  const bare = h.card.render(80).map(strip);
  // Box occupies content rows 1..8 (top + 6 inner + bottom) inside 9 rows.
  assert.equal(bare[2], "│2   " + EDITOR_TOP + " ".repeat(10) + "│");
  for (let k = 3; k <= 7; k++) {
    assert.equal(bare[k], `│${k}   │` + "a".repeat(62) + "│" + " ".repeat(10) + "│");
  }
  // Last visible row is the cursor's row (the tail of the text), full width.
  assert.equal(bare[8], "│8   │" + "a".repeat(28) + " " + " ".repeat(33) + "│" + " ".repeat(10) + "│");
  assert.equal(bare[9], "│9   " + EDITOR_BOTTOM + " ".repeat(10) + "│");
  // The scrolled-off head row (the first 62-char row) is not rendered.
  assert.equal(bare.filter((r) => r.includes("a".repeat(62))).length, 5);
  assert.equal(bare.length, 12); // occlusion, not push-down: 9 content + 3 chrome
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
  const tail = "a".repeat(6); // display cols 68..73 survive right of the box
  assert.equal(strip(row), "│1 * " + EDITOR_TOP + tail + " ".repeat(4) + "│");
  assert.ok(!strip(row).includes("\x1b"), "no broken escape sequences survive the splice");
  // The right sliver re-opens the carried SGR state before the surviving
  // text: both the inverse (7m) and underline (4m) attributes re-appear.
  const afterBox = row.slice(row.lastIndexOf("\u256e") + 1); // after the box's right border glyph
  const sliverCodes = afterBox.slice(0, afterBox.indexOf("aaaaaa"));
  assert.ok(sliverCodes.includes("\x1b[4m") && sliverCodes.includes("\x1b[7m"), `sliver carries SGR state, got: ${JSON.stringify(afterBox)}`);
  // The surviving text closes its underline attribute (no permanent bleed).
  assert.ok(afterBox.includes("\x1b[24m"));
});

test("comment box flips above the selection near the viewport bottom", () => {
  const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const h = makeCard({ lines, rows: 12 });
  h.card.handleInput("G");
  h.card.handleInput("v");
  h.card.handleInput("c");
  const bare = h.card.render(80).map(strip);
  // Overlay budget: floor(0.8 * 12) = 9 rows -> 6 content rows + 3 chrome;
  // scrolled so line j (index 9) is last: content shows lines e..j, rel 0..5.
  assert.equal(bare.length, 9);
  // selBottom 5 + 1 + boxH 3 > 6 -> flip above: box occupies content rows 2-4.
  // Fixed-width box (64) at width 80: left edge = gutter width (5), unclamped.
  assert.equal(bare[3].indexOf("╭─ Comment"), 1 + 5);
  assert.equal(bare[5].indexOf("╰"), 1 + 5);
  // The selected line below the box is intact; the footer shows comment hints.
  assert.ok(bare[6].startsWith("│10   j"));
  assert.ok(bare[7].startsWith("│-- COMMENT --"));
});

test("comment box left edge clamps inside the right border", () => {
  const lines = ["x".repeat(60), "y", "z", "u", "v", "w"];
  const h = makeCard({ lines });
  h.card.handleInput("$");
  h.card.handleInput("v");
  h.card.handleInput("c");
  const width = 80;
  const bare = h.card.render(width).map(strip);
  const inner = width - 2; // 78; boxW fixed at 64
  const left = inner - 64; // selCol (gutter 4 + 60) clamps to inner - boxW = 14
  assert.equal(bare[2].indexOf("╭─ Comment"), 1 + left);
  // The box ends exactly at the inner width, inside the right border.
  assert.ok(bare[2].endsWith("╮│"));
});

// Pending styling -------------------------------------------------------------

test("pending markers: SGR 4 underline on the range text, warning gutter star", () => {
  const h = makeCard({ lines: ["abcd", "efgh"] });
  h.pending.push({ startLine: 0, startCol: 1, endLine: 0, endCol: 3 });
  const rows = h.card.render(40);
  const warned = h.fgCalls.filter((c) => c.token === "warning").map((c) => c.text);
  assert.ok(warned.includes("*")); // gutter marker stays theme warning
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
  const tail = " ".repeat(width - 2 - 17); // gutter 4 + box 13
  // Box opens one row below the cursor row (row 0), left edge at the draft's
  // start display column (gutter 4 + col 0): same chrome and placement as
  // the comment-mode box.
  assert.equal(bare[2], "│2   ╭─ Comment ─╮" + tail + "│");
  assert.equal(bare[3], "│3   │note       │" + tail + "│");
  assert.equal(bare[4], "│4   ╰───────────╯" + tail + "│");
  // Occlusion, not push-down: 5 content rows + 3 chrome rows, unchanged.
  assert.equal(bare.length, 8);
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
  assert.ok(strip(bare[2]).startsWith("│2   beta")); // content row intact
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
  const boxRow = rows.find((r) => strip(r).includes("│note")) as string;
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
  assert.ok(bare[3].includes("│c0"));
  assert.ok(bare[6].includes("│c3"));
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
  // Left edge = border 1 + gutter 4 + draft startCol 2 (not the cursor col 2).
  assert.equal(bare[2].indexOf("╭─ Comment"), 1 + 4 + 2);
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
  assert.ok(bare.some((r) => r.includes("│prefill")));
  assert.ok(bare[bare.length - 2].startsWith("│-- COMMENT --"));
  // Esc back to normal: the read-only preview is shown again.
  h.card.handleInput("\x1b");
  bare = h.card.render(40).map(strip);
  assert.ok(bare[2].includes("╭─ Comment"));
});
