import { test } from "node:test";
import assert from "node:assert/strict";

import { visibleWidth } from "@earendil-works/pi-tui";

import { buildDisplayLine } from "../../src/tui/display.ts";

test("buildDisplayLine maps raw UTF-16 spans to display columns under a styled prefix", () => {
  const line = buildDisplayLine("a\tb", {
    prefix: "> ",
    prefixStyle: "mdQuoteBorder",
    spans: [{ startCol: 2, endCol: 3, style: "mdBold" }],
  });
  assert.equal(line.raw, "a\tb");
  assert.equal(line.text, "> a   b");
  assert.equal(line.prefixWidth, 2);
  // Raw cols 2..3 (the "b") expand past the tab to display 4..5, plus the
  // 2-column quote prefix: 6..7.
  assert.deepEqual(line.spans.at(-1), { start: 6, end: 7, style: "mdBold" });
  assert.deepEqual(line.spans[0], { start: 0, end: 2, style: "mdQuoteBorder" });
});

test("buildDisplayLine without a scan or with an empty prefix keeps the plain tab-expanded line", () => {
  assert.deepEqual(buildDisplayLine("a\tb"), { raw: "a\tb", text: "a   b", prefixWidth: 0, spans: [] });
  assert.deepEqual(buildDisplayLine("abc", { prefix: "" }), { raw: "abc", text: "abc", prefixWidth: 0, spans: [] });
});

test("buildDisplayLine paints an ANSI-highlighted base whose visible width matches the raw geometry", () => {
  const highlighted = "\x1b[7ma\x1b[27m   b";
  const line = buildDisplayLine(
    "a\tb",
    { prefix: "  ", spans: [{ startCol: 0, endCol: 1, style: "mdHeading" }] },
    highlighted,
  );
  assert.equal(line.text, "  " + highlighted);
  assert.equal(line.prefixWidth, 2);
  assert.equal(visibleWidth(line.text), 7);
  // Columns always map from raw through the tab geometry, never from ANSI bytes.
  assert.deepEqual(line.spans, [{ start: 2, end: 3, style: "mdHeading" }]);
});

test("buildDisplayLine sorts unsorted raw spans, maps them in one batch, and never mutates the scan input", () => {
  const spans = [
    { startCol: 2, endCol: 3, style: "mdItalic" as const },
    { startCol: 1, endCol: 3, style: "mdBold" as const },
  ];
  const line = buildDisplayLine("a\tb", { spans });
  // Raw col 1 sits at the tab (display 1); cols 2..3 expand to 4..5, the
  // line's end. Spans come back sorted by raw start; the input array keeps
  // its original order.
  assert.deepEqual(line.spans, [
    { start: 1, end: 5, style: "mdBold" },
    { start: 4, end: 5, style: "mdItalic" },
  ]);
  assert.deepEqual(spans, [
    { startCol: 2, endCol: 3, style: "mdItalic" },
    { startCol: 1, endCol: 3, style: "mdBold" },
  ]);
});

test("buildDisplayLine omits zero-width raw spans", () => {
  const line = buildDisplayLine("abc", {
    spans: [
      { startCol: 1, endCol: 1, style: "mdBold" },
      { startCol: 0, endCol: 2, style: "mdDim" },
    ],
  });
  assert.deepEqual(line.spans, [{ start: 0, end: 2, style: "mdDim" }]);
});

test("uses whole-grapheme columns for multi-code-point emoji before tabs and styled text", () => {
  for (const [emoji, xCol] of [
    ["\u{1F44D}\u{1F3FD}", 5],
    ["\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", 9],
  ] as const) {
    const raw = `${emoji}\tX`;
    const line = buildDisplayLine(raw, { spans: [{ startCol: xCol, endCol: xCol + 1, style: "mdBold" }] });
    assert.equal(line.text, `${emoji}  X`);
    assert.deepEqual(line.spans, [{ start: 4, end: 5, style: "mdBold" }]);
  }
});
