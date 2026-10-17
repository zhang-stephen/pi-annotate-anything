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
// tokens the chrome must use (border, dim, accent, warning, customMessageBg).

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
  const width = 80; // the normal-mode footer hints are 65 columns wide
  const rows = h.card.render(width);
  const bare = rows.map(strip);
  assert.equal(rows.length, 5); // top border + 2 content rows + footer + bottom border
  assert.equal(bare[0], "╭─ Annotate: src/a.ts " + "─".repeat(57) + "╮");
  assert.equal(bare[1], "│1   alpha" + " ".repeat(69) + "│");
  assert.ok(bare[3].startsWith("│hjkl move"));
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

test("chrome colors come from the theme: customMessageBg bg-fill and fg tokens", () => {
  const h = makeCard({ lines: ["alpha"] });
  const rows = h.card.render(40);
  for (const row of rows) assert.ok(row.includes(BG_ON), "row is background-filled");
  assert.ok(h.bgCalls.length >= rows.length);
  for (const call of h.bgCalls) assert.equal(call.token, "customMessageBg");
  const tokens = new Set(h.fgCalls.map((c) => c.token));
  assert.ok(tokens.has("border"));
  assert.ok(tokens.has("dim"));
});

test("footer hints follow the mode: badge in accent, hints in dim", () => {
  // Width 80 leaves room for the full fixed hint strings (no truncation).
  const normal = makeCard({ lines: ["alpha", "beta"] });
  let bare = normal.card.render(80).map(strip);
  assert.ok(bare[3].startsWith("│hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close"));
  assert.ok(normal.fgCalls.some((c) => c.token === "dim" && c.text === "hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close"));
  assert.ok(!normal.fgCalls.some((c) => c.token === "accent")); // normal shows no badge

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

test("comment box floats below the selection, replacing occluded content rows", () => {
  const lines = ["abc", "def", "ghi", "jkl", "mno"];
  const h = makeCard({ lines });
  h.card.handleInput("v");
  h.card.handleInput("c");
  h.card.handleInput("hi");
  const width = 40;
  const bare = h.card.render(width).map(strip);
  // No push-down: 5 content rows + 3 chrome rows, unchanged by the box.
  assert.equal(bare.length, 8);
  // Selection at line 0 col 0, gutter width 4 -> box opens at row 1, col 4.
  // The first 4 columns of each occluded row (its gutter) stay visible.
  const tail = " ".repeat(width - 2 - 17);
  assert.equal(bare[2], "│2   ╭─ Comment ─╮" + tail + "│");
  assert.equal(bare[3], "│3   │hi         │" + tail + "│");
  assert.equal(bare[4], "│4   ╰───────────╯" + tail + "│");
  // Border and footer stay clear of the box (comment-mode hints).
  assert.ok(bare[6].startsWith("│-- COMMENT --"));
  assert.equal(bare[7], "╰" + "─".repeat(38) + "╯");
});

test("comment box flips above the selection near the viewport bottom", () => {
  const lines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const h = makeCard({ lines, rows: 12 });
  h.card.handleInput("G");
  h.card.handleInput("v");
  h.card.handleInput("c");
  const bare = h.card.render(40).map(strip);
  // Overlay budget: floor(0.8 * 12) = 9 rows -> 6 content rows + 3 chrome;
  // scrolled so line j (index 9) is last: content shows lines e..j, rel 0..5.
  assert.equal(bare.length, 9);
  // selBottom 5 + 1 + boxH 3 > 6 -> flip above: box occupies content rows 2-4.
  const left = gutterWidth(10); // 5: two digits + marker column + separators
  assert.equal(bare[3].indexOf("╭─ Comment"), 1 + left);
  assert.equal(bare[5].indexOf("╰"), 1 + left);
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
  const width = 40;
  const bare = h.card.render(width).map(strip);
  const inner = width - 2;
  const boxW = 13; // empty comment: minimum width set by the Comment title
  const left = inner - boxW; // selCol (gutter 4 + 60) clamps to inner - boxW
  assert.equal(bare[2].indexOf("╭─ Comment"), 1 + left);
});

// Pending styling -------------------------------------------------------------

test("pending markers use the theme warning color: gutter star and underline", () => {
  const h = makeCard({ lines: ["abcd", "efgh"] });
  h.pending.push({ startLine: 0, startCol: 1, endLine: 0, endCol: 3 });
  const rows = h.card.render(40);
  const warned = h.fgCalls.filter((c) => c.token === "warning").map((c) => c.text);
  assert.ok(warned.includes("*")); // gutter marker
  assert.ok(warned.includes("bc")); // underline span cols 1..3
  for (const row of rows) assert.ok(!row.includes("\x1b[4m"), "no raw ANSI underline");
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
