import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";

import { gutterWidth, rawColToDisplayCol, tabExpanded } from "../src/viewer.ts";

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
