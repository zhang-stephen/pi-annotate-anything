import { test } from "node:test";
import assert from "node:assert/strict";

import { scanMarkdown } from "../../src/viewer/markdown.ts";
import type { DisplayScanLine, MdSpanStyle, RawStyleSpan } from "../../src/tui/display.ts";

// Golden tests for the verbatim-verified Markdown scanner: exactly one
// DisplayScanLine per input raw line, spans in raw UTF-16 columns, literal
// prefixes fixed-width and tab-free, and verbatim-verify degradation that
// drops spans without ever throwing or changing line counts.
function span(startCol: number, endCol: number, style: MdSpanStyle): RawStyleSpan {
  return { startCol, endCol, style };
}

function at(line: string, needle: string): number {
  const idx = line.indexOf(needle);
  assert.ok(idx >= 0, `fixture substring ${needle} not found`);
  return idx;
}

test("ATX headings dim the marker run and style the content", () => {
  const heading = scanMarkdown(["# head"])[0];
  assert.deepEqual(heading.spans, [
    { startCol: 0, endCol: 2, style: "mdDim" },
    { startCol: 2, endCol: 6, style: "mdHeading" },
  ]);
});

test("deeper ATX headings keep the marker-width dim run", () => {
  const line = "### deep";
  const scan = scanMarkdown([line])[0];
  assert.deepEqual(scan.spans, [
    span(0, 4, "mdDim"),
    span(4, line.length, "mdHeading"),
  ]);
});

test("ATX closing sequences dim instead of styling as content", () => {
  const line = "# closed #";
  const scan = scanMarkdown([line])[0];
  assert.deepEqual(scan.spans, [
    span(0, 2, "mdDim"),
    span(2, 8, "mdHeading"),
    span(8, 10, "mdDim"),
  ]);
});

test("setext headings style the content line and dim the underline", () => {
  const scans = scanMarkdown(["Title", "====="]);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0].spans, [span(0, 5, "mdHeading")]);
  assert.deepEqual(scans[1].spans, [span(0, 5, "mdDim")]);
});

test("inline emphasis constructs verify verbatim: dim delimiters, styled content", () => {
  const line =
    "plain **bold** *em* ~~strike~~ `code` \\* esc [t](http://u) ![alt](i.png) &amp; <b>html</b> end";
  const bold = at(line, "**bold**");
  const em = at(line, "*em*");
  const del = at(line, "~~strike~~");
  const code = at(line, "`code`");
  const esc = at(line, "\\*");
  const link = at(line, "[t](http://u)");
  const image = at(line, "![alt](i.png)");
  const scan = scanMarkdown([line])[0];
  assert.deepEqual(scan.spans, [
    span(bold, bold + 2, "mdDim"),
    span(bold + 2, bold + 6, "mdBold"),
    span(bold + 6, bold + 8, "mdDim"),
    span(em, em + 1, "mdDim"),
    span(em + 1, em + 3, "mdItalic"),
    span(em + 3, em + 4, "mdDim"),
    span(del, del + 2, "mdDim"),
    span(del + 2, del + 8, "mdStrike"),
    span(del + 8, del + 10, "mdDim"),
    span(code, code + 1, "mdDim"),
    span(code + 1, code + 5, "mdCode"),
    span(code + 5, code + 6, "mdDim"),
    span(esc, esc + 1, "mdDim"),
    span(link + 1, link + 2, "mdLink"),
    span(link + 4, link + 12, "mdLinkUrl"),
    span(image, image + 13, "mdDim"),
  ]);
});

test("entities and raw HTML stay plain", () => {
  const scan = scanMarkdown(["a &amp; b <b>c</b> d"])[0];
  assert.equal(scan.spans, undefined);
  assert.equal(scan.prefix, undefined);
});

test("fenced code blocks take whole-line styles with no inline styling inside", () => {
  const fence = "let a = **bold**;";
  const scans = scanMarkdown(["```js", fence, "```"]);
  assert.equal(scans.length, 3);
  assert.deepEqual(scans[0].spans, [span(0, 5, "mdCodeBlockBorder")]);
  assert.deepEqual(scans[1].spans, [span(0, fence.length, "mdCodeBlock")]);
  assert.deepEqual(scans[2].spans, [span(0, 3, "mdCodeBlockBorder")]);
});

test("indented code blocks are wholly code-styled without inline styling", () => {
  const body = "    indented **bold** code";
  const scans = scanMarkdown(["text", "", body]);
  assert.equal(scans.length, 3);
  assert.equal(scans[0].spans, undefined);
  assert.equal(scans[1].spans, undefined);
  assert.deepEqual(scans[2].spans, [span(0, body.length, "mdCodeBlock")]);
});

test("unclosed fences style the interior as code, not as a border row", () => {
  const scans = scanMarkdown(["```js", "never closed"]);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0].spans, [span(0, 5, "mdCodeBlockBorder")]);
  assert.deepEqual(scans[1].spans, [span(0, 12, "mdCodeBlock")]);
});

test("thematic breaks style the rule", () => {
  assert.deepEqual(scanMarkdown(["---"])[0].spans, [span(0, 3, "mdHr")]);
  assert.deepEqual(scanMarkdown(["***"])[0].spans, [span(0, 3, "mdHr")]);
});

test("unordered and ordered list markers get the bullet style", () => {
  const bullet = scanMarkdown(["- a", "- b"]);
  assert.deepEqual(bullet[0].spans, [span(0, 2, "mdListBullet")]);
  assert.deepEqual(bullet[1].spans, [span(0, 2, "mdListBullet")]);
  const ordered = scanMarkdown(["1. one", "2. two"]);
  assert.deepEqual(ordered[0].spans, [span(0, 3, "mdListBullet")]);
  assert.deepEqual(ordered[1].spans, [span(0, 3, "mdListBullet")]);
});

test("a bare marker with no trailing space still styles the marker run", () => {
  const scans = scanMarkdown(["-", "- x"]);
  assert.deepEqual(scans[0].spans, [span(0, 1, "mdListBullet")]);
  assert.deepEqual(scans[1].spans, [span(0, 2, "mdListBullet")]);
});

test("hanging-indent continuation lines get a marker-width space prefix", () => {
  const scans = scanMarkdown(["- item", "  cont"]);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0].spans, [span(0, 2, "mdListBullet")]);
  assert.deepEqual(scans[1], { prefix: "  " } satisfies DisplayScanLine);
  const ordered = scanMarkdown(["1. one", "   more"]);
  assert.equal(ordered[0].prefix, undefined);
  assert.deepEqual(ordered[1], { prefix: "   " } satisfies DisplayScanLine);
});

test("tight list items style inline emphasis inside the item", () => {
  const scans = scanMarkdown(["- **bold** item"]);
  assert.equal(scans.length, 1);
  assert.deepEqual(scans[0].spans, [
    span(0, 2, "mdListBullet"),
    span(2, 4, "mdDim"),
    span(4, 8, "mdBold"),
    span(8, 10, "mdDim"),
  ]);
});

test("nested list continuation prefixes add up exactly", () => {
  const scans = scanMarkdown(["- parent", "  - child", "    deep"]);
  assert.equal(scans.length, 3);
  assert.deepEqual(scans[0].spans, [span(0, 2, "mdListBullet")]);
  assert.equal(scans[0].prefix, undefined);
  assert.deepEqual(scans[1].spans, [span(2, 4, "mdListBullet")]);
  assert.equal(scans[1].prefix, "  ");
  assert.equal(scans[2].spans, undefined);
  assert.equal(scans[2].prefix, "    ");
});

test("quote lines get the fixed-width glyph prefix", () => {
  const scans = scanMarkdown(["> quoted", "> more"]);
  assert.deepEqual(scans[0], { prefix: "▎ ", prefixStyle: "mdQuoteBorder" } satisfies DisplayScanLine);
  assert.deepEqual(scans[1], { prefix: "▎ ", prefixStyle: "mdQuoteBorder" } satisfies DisplayScanLine);
});

test("doubled quotes compose the glyph prefix additively", () => {
  const scans = scanMarkdown(["> > deep"]);
  assert.deepEqual(scans[0], {
    prefix: "▎ ▎ ",
    prefixStyle: "mdQuoteBorder",
  } satisfies DisplayScanLine);
});

test("quote plus list nesting adds prefix widths exactly", () => {
  const scans = scanMarkdown(["> - item", ">   cont"]);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0], {
    prefix: "▎ ",
    prefixStyle: "mdQuoteBorder",
    spans: [span(2, 4, "mdListBullet")],
  } satisfies DisplayScanLine);
  assert.deepEqual(scans[1], {
    prefix: "▎   ",
    prefixStyle: "mdQuoteBorder",
  } satisfies DisplayScanLine);
});

test("list plus quote nesting adds prefix widths exactly", () => {
  const scans = scanMarkdown(["- > quoted", "  > more"]);
  assert.equal(scans.length, 2);
  assert.deepEqual(scans[0], {
    prefix: "▎ ",
    prefixStyle: "mdQuoteBorder",
    spans: [span(0, 2, "mdListBullet")],
  } satisfies DisplayScanLine);
  assert.deepEqual(scans[1], {
    prefix: "  ▎ ",
    prefixStyle: "mdQuoteBorder",
  } satisfies DisplayScanLine);
});

test("link reference definitions are wholly dimmed", () => {
  const line = '[ref]: http://x.com "T"';
  const scan = scanMarkdown([line])[0];
  assert.deepEqual(scan.spans, [span(0, line.length, "mdDim")]);
});

test("images are wholly dimmed", () => {
  const line = "![alt](i.png) lead";
  const scan = scanMarkdown([line])[0];
  assert.deepEqual(scan.spans, [span(0, 13, "mdDim")]);
});

test("tables stay plain", () => {
  const scans = scanMarkdown(["| a | b |", "|---|---|", "| 1 | 2 |"]);
  assert.equal(scans.length, 3);
  for (const scan of scans) {
    assert.equal(scan.spans, undefined);
    assert.equal(scan.prefix, undefined);
  }
});

test("LaTeX blocks stay plain", () => {
  const scans = scanMarkdown(["$$", "x = y", "$$"]);
  assert.equal(scans.length, 3);
  for (const scan of scans) {
    assert.equal(scan.spans, undefined);
    assert.equal(scan.prefix, undefined);
  }
});

test("a link-class token that fails verbatim shape verification degrades to plain", () => {
  // A link reference definition fragment lexes into a bare-URL link token
  // that fits no verbatim link shape; the affected span must be dropped
  // without throwing and without changing the line count.
  const line = "[ref]: http://x.com trailing words";
  const scans = scanMarkdown([line]);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].spans, undefined);
  assert.ok(!line.includes("\t"));
});

test("malformed input never throws and keeps exactly one scan per raw line", () => {
  const lines = ["**bold", "unclosed `code", "```js", "never closed", "["];
  const scans = scanMarkdown(lines);
  assert.equal(scans.length, lines.length);
  for (const scan of scans) assert.equal(typeof scan, "object");
});

test("empty input yields no scans", () => {
  assert.deepEqual(scanMarkdown([]), []);
});

test("mixed documents keep one scan per raw line in order", () => {
  const lines = [
    "# doc",
    "",
    "- a",
    "",
    "> q",
    "",
    "```",
    "code **bold**",
    "```",
    "",
    "|a|b|",
    "|-|-|",
    "",
    "[r]: http://x",
    "",
    "last",
  ];
  const scans = scanMarkdown(lines);
  assert.equal(scans.length, lines.length);
  for (const scan of scans) assert.equal(typeof scan, "object");
});

test("trailing carriage returns are tolerated verbatim, not rewritten", () => {
  const scans = scanMarkdown(["**bold** line\r"]);
  assert.equal(scans.length, 1);
  assert.deepEqual(scans[0].spans, [
    span(0, 2, "mdDim"),
    span(2, 6, "mdBold"),
    span(6, 8, "mdDim"),
  ]);
});

test("literal prefixes are fixed-width and never contain tabs", () => {
  const lines = ["> - item", ">   cont", "- > quoted", "  > more", "- parent", "  - child"];
  for (const scan of scanMarkdown(lines)) {
    if (scan.prefix !== undefined) {
      assert.ok(!scan.prefix.includes("\t"), "prefix must not contain tabs");
      assert.ok(scan.prefix.length >= 2, "prefix must be fixed-width literal text");
    }
  }
});
