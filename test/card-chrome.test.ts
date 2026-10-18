import { test } from "node:test";
import assert from "node:assert/strict";

import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import { commentBoxPlacement, draftAtCursor, frameCommentBox, framePanel } from "../src/card-chrome.ts";
import type { ChromeColors } from "../src/card-chrome.ts";
import type { Draft } from "../src/store.ts";

// Marker color functions: wrap text so exact string assertions can see where
// each color function was applied, independent of real ANSI codes.
const colors: ChromeColors = {
  bg: (s) => `bg(${s})`,
  border: (s) => `b(${s})`,
  dim: (s) => `d(${s})`,
  accent: (s) => `a(${s})`,
  warning: (s) => `w(${s})`,
};
const plain: ChromeColors = {
  bg: (s) => s,
  border: (s) => s,
  dim: (s) => s,
  accent: (s) => s,
  warning: (s) => s,
};

function draft(over: Partial<Draft>): Draft {
  return {
    token: "[f.ts:1-2]",
    absPath: "/f.ts",
    range: { startLine: 1, startCol: 0, endLine: 2, endCol: 5 },
    mode: "line",
    snapshot: "",
    comment: "",
    ...over,
  };
}

// framePanel ------------------------------------------------------------------

test("framePanel draws rounded borders, embedded title, footers as last inner rows", () => {
  const rows = framePanel(["ab", "cd"], 10, { title: "T", footers: ["F"], colors });
  assert.deepEqual(rows, [
    "bg(b(╭─ T ────╮))",
    "bg(b(│)ab      b(│))",
    "bg(b(│)cd      b(│))",
    "bg(b(│)F       b(│))",
    "bg(b(╰────────╯))",
  ]);
});

test("framePanel pads every row to the full display width (wide chars count 2)", () => {
  const rows = framePanel(["ab", "中文"], 12, { title: "T", footers: ["hj"], colors: plain });
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(visibleWidth(row), 12);
  }
  assert.equal(rows[0], "╭─ T ──────╮");
  assert.equal(rows[2], "│中文      │");
});

test("framePanel left-truncates overlong titles keeping the tail", () => {
  const rows = framePanel([], 16, { title: "src/very/long/path/file.ts", colors: plain });
  assert.equal(rows.length, 2);
  assert.equal(rows[0], "╭─ th/file.ts ─╮");
  assert.equal(visibleWidth(rows[0]), 16);
});

test("framePanel truncates wide-char titles by display width", () => {
  const rows = framePanel([], 12, { title: "中文标题", colors: plain });
  assert.equal(rows[0], "╭─ 文标题 ─╮");
  assert.equal(visibleWidth(rows[0]), 12);
});

test("framePanel omits the title and footers when not given", () => {
  const rows = framePanel(["x"], 8, { colors: plain });
  assert.deepEqual(rows, ["╭──────╮", "│x     │", "╰──────╯"]);
});

test("framePanel renders footers in order, one inner row each", () => {
  // Two footers (statusline above cmdline) produce two inner rows below the
  // content rows, in the given order.
  const rows = framePanel(["ab"], 10, { title: "T", footers: ["S", "C"], colors });
  assert.deepEqual(rows, [
    "bg(b(╭─ T ────╮))",
    "bg(b(│)ab      b(│))",
    "bg(b(│)S       b(│))",
    "bg(b(│)C       b(│))",
    "bg(b(╰────────╯))",
  ]);
});

test("framePanel keeps footer geometry on ANSI-styled content", () => {
  const rows = framePanel(["a"], 12, { footers: ["\x1b[2mESC Esc\x1b[22m"], colors: plain });
  assert.equal(rows.length, 4);
  assert.equal(rows[2], "│\x1b[2mESC Esc\x1b[22m   │");
  assert.equal(visibleWidth(rows[2]), 12);
});

// frameCommentBox ---------------------------------------------------------------

test("frameCommentBox draws a bordered box with embedded title and padded rows", () => {
  const rows = frameCommentBox(["hello", "world"], 14, colors, "Comment");
  assert.deepEqual(rows, [
    "bg(b(╭─ Comment ──╮))",
    "bg(b(│)hello       b(│))",
    "bg(b(│)world       b(│))",
    "bg(b(╰────────────╯))",
  ]);
});

test("frameCommentBox truncates long lines by display width", () => {
  const rows = frameCommentBox(["abcdefghijklmnopqrstuvwxyz"], 14, plain, "C");
  // truncateToWidth fills with the pi-tui default ellipsis; it wraps the
  // ellipsis in ANSI resets, so compare the ANSI-stripped form.
  assert.equal(stripTerminalSequences(rows[1]), "│abcdefghi...│");
  assert.equal(visibleWidth(rows[1]), 14);
});

test("frameCommentBox backgrounds every row and pads wide-char content", () => {
  const rows = frameCommentBox(["中文"], 12, colors, "");
  assert.equal(rows.length, 3);
  assert.equal(rows[0], "bg(b(╭──────────╮))");
  assert.equal(rows[1], "bg(b(│)中文      b(│))");
  assert.equal(rows[2], "bg(b(╰──────────╯))");
  // The exact strings above already pin the padding (中文 + 6 spaces fills
  // the 10-column interior), so no separate width loop is needed here.
});

// commentBoxPlacement -----------------------------------------------------------

test("commentBoxPlacement opens below the selection by default", () => {
  assert.deepEqual(commentBoxPlacement(2, 4, 7, 3, 8, 20, 10), { top: 5, left: 7 });
});

test("commentBoxPlacement stays below when the box exactly reaches the footer", () => {
  assert.deepEqual(commentBoxPlacement(2, 6, 0, 3, 8, 20, 10), { top: 7, left: 0 });
});

test("commentBoxPlacement flips above the selection when it does not fit below", () => {
  assert.deepEqual(commentBoxPlacement(5, 8, 0, 3, 8, 20, 10), { top: 2, left: 0 });
});

test("commentBoxPlacement clamps the left edge inside the border columns", () => {
  // Right side: selCol 18 with boxW 6 in innerW 20 clamps to 14 (box ends at 19).
  assert.deepEqual(commentBoxPlacement(0, 0, 18, 2, 6, 20, 10), { top: 1, left: 14 });
  // Left side: negative selCol clamps to 0.
  assert.deepEqual(commentBoxPlacement(0, 0, -3, 2, 6, 20, 10), { top: 1, left: 0 });
});

test("commentBoxPlacement clamps degenerate box sizes", () => {
  // Forced flip with the selection at row 0 (8+1+4 > 10 flips, 0-4 clamps to 0).
  assert.deepEqual(commentBoxPlacement(0, 8, 2, 4, 6, 20, 10), { top: 0, left: 2 });
  // Box taller than the viewport: top clamps to 0; wider than the panel: left clamps to 0.
  assert.deepEqual(commentBoxPlacement(3, 4, 2, 20, 30, 20, 10), { top: 0, left: 0 });
});

// draftAtCursor -----------------------------------------------------------------

// A draft covering lines 10..20; cols only matter on the boundary lines.
test("draftAtCursor returns the draft covering the cursor position", () => {
  const d = draft({ range: { startLine: 10, startCol: 0, endLine: 20, endCol: 3 } });
  assert.equal(draftAtCursor(15, 0, [d]), d);
});

test("draftAtCursor line bounds are inclusive on both ends", () => {
  const d = draft({ range: { startLine: 10, startCol: 2, endLine: 20, endCol: 3 } });
  assert.equal(draftAtCursor(10, 2, [d]), d); // start line at the start col
  assert.equal(draftAtCursor(20, 3, [d]), d); // end line at the end col
  assert.equal(draftAtCursor(9, 0, [d]), undefined);
  assert.equal(draftAtCursor(21, 0, [d]), undefined);
});

test("draftAtCursor is column-precise on boundary lines", () => {
  const d = draft({ range: { startLine: 10, startCol: 2, endLine: 12, endCol: 4 } });
  // Start line: columns before startCol miss.
  assert.equal(draftAtCursor(10, 0, [d]), undefined);
  assert.equal(draftAtCursor(10, 1, [d]), undefined);
  assert.equal(draftAtCursor(10, 2, [d]), d);
  // End line: columns past endCol miss.
  assert.equal(draftAtCursor(12, 4, [d]), d);
  assert.equal(draftAtCursor(12, 5, [d]), undefined);
  assert.equal(draftAtCursor(12, 9, [d]), undefined);
  // Inner lines hit at any column.
  assert.equal(draftAtCursor(11, 0, [d]), d);
  assert.equal(draftAtCursor(11, 99, [d]), d);
});

test("draftAtCursor: whole-line (V-mode) drafts hit anywhere on their lines", () => {
  const lineWise = draft({ mode: "line", range: { startLine: 7, startCol: 0, endLine: 7, endCol: 40 } });
  assert.equal(draftAtCursor(7, 0, [lineWise]), lineWise);
  assert.equal(draftAtCursor(7, 17, [lineWise]), lineWise);
  assert.equal(draftAtCursor(7, 40, [lineWise]), lineWise); // clamped cursor col = line length
});

test("draftAtCursor: an empty (single-cell) range hits only on its exact column", () => {
  const d = draft({ range: { startLine: 5, startCol: 3, endLine: 5, endCol: 3 } });
  assert.equal(draftAtCursor(5, 3, [d]), d);
  assert.equal(draftAtCursor(5, 2, [d]), undefined);
  assert.equal(draftAtCursor(5, 4, [d]), undefined);
});

test("draftAtCursor returns the last draft among overlapping ranges", () => {
  const first = draft({ token: "[f.ts:10-20]", range: { startLine: 10, startCol: 0, endLine: 20, endCol: 9 } });
  const second = draft({ token: "[f.ts:12-15]", range: { startLine: 12, startCol: 2, endLine: 15, endCol: 7 } });
  assert.equal(draftAtCursor(13, 4, [first, second]), second);
  assert.equal(draftAtCursor(11, 4, [first, second]), first);
});

test("draftAtCursor covers char-wise and line-wise ranges alike", () => {
  const charWise = draft({
    mode: "char",
    range: { startLine: 3, startCol: 2, endLine: 5, endCol: 9 },
  });
  const lineWise = draft({
    mode: "line",
    range: { startLine: 7, startCol: 0, endLine: 7, endCol: 40 },
  });
  assert.equal(draftAtCursor(4, 6, [charWise, lineWise]), charWise);
  assert.equal(draftAtCursor(7, 6, [charWise, lineWise]), lineWise);
});

test("draftAtCursor returns undefined when nothing covers the cursor", () => {
  const d = draft({ range: { startLine: 10, startCol: 0, endLine: 12, endCol: 3 } });
  assert.equal(draftAtCursor(11, 0, []), undefined);
  assert.equal(draftAtCursor(15, 0, [d]), undefined);
});
