import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDisplayLine } from "../../src/tui/display.ts";
import type { DisplayLine, DisplayScanLine } from "../../src/tui/display.ts";
import { buildVisualLayout, toRawPosition, toVisualPosition } from "../../src/viewer/wrap.ts";

// Builds the display line per raw line with optional per-line scan plans
// (block prefixes and raw-column spans), mirroring how the viewer feeds
// the markdown scanner output into layout building.
function displaysOf(lines: string[], scans?: (DisplayScanLine | undefined)[]): DisplayLine[] {
  return lines.map((raw, i) => buildDisplayLine(raw, scans?.[i]));
}

test("hard-breaks an unbreakable line at whole-grapheme raw column boundaries", () => {
  const lines = ["abcdefgh"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 3);
  assert.deepEqual(layout.rows.map((r) => [r.line, r.startCol, r.endCol]), [
    [0, 0, 3],
    [0, 3, 6],
    [0, 6, 8],
  ]);
  assert.deepEqual(layout.rows.map((r) => r.text), ["abc", "def", "gh"]);
  assert.deepEqual(layout.rows.map((r) => r.continuation), [false, true, true]);
  assert.deepEqual(layout.rows.map((r) => r.prefixWidth), [0, 0, 0]);
});

test("prefers a break after whitespace and keeps the break space on the preceding row", () => {
  const lines = ["alpha beta gamma"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 10);
  // The break space ends row 0 exactly once; row 1 starts at "beta" and
  // fits the remaining text without another break.
  assert.deepEqual(layout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 6, "alpha "],
    [6, 16, "beta gamma"],
  ]);
  assert.equal(layout.rows.map((r) => lines[0].slice(r.startCol, r.endCol)).join(""), lines[0]);
});

test("keeps the break space exactly once even when the break strands a short row", () => {
  const lines = ["aaaa bbbb"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 4);
  assert.deepEqual(layout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 4, "aaaa"],
    [4, 5, " "],
    [5, 9, "bbbb"],
  ]);
  assert.equal(layout.rows.map((r) => lines[0].slice(r.startCol, r.endCol)).join(""), lines[0]);
});

test("allows breaks between CJK graphemes at raw UTF-16 columns", () => {
  const lines = ["\u4f60\u597d\u4e16\u754c"]; // two CJK pairs
  const layout = buildVisualLayout(lines, displaysOf(lines), 4);
  assert.deepEqual(layout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 2, "\u4f60\u597d"],
    [2, 4, "\u4e16\u754c"],
  ]);
  // A CJK break is preferred mid-row: "ab" + CJK pair at width 4 breaks
  // between the two CJK graphemes instead of hard-breaking earlier.
  const mixed = ["ab\u4f60\u4f60"];
  const mixedLayout = buildVisualLayout(mixed, displaysOf(mixed), 4);
  assert.deepEqual(mixedLayout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 3, "ab\u4f60"],
    [3, 4, "\u4f60"],
  ]);
});

test("keeps a wide grapheme that exactly fits the boundary and moves one that cannot fit the remaining cell", () => {
  // The wide grapheme ends exactly at display column 4.
  const exact = ["ab\u4f60c"];
  const exactLayout = buildVisualLayout(exact, displaysOf(exact), 4);
  assert.deepEqual(exactLayout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 3, "ab\u4f60"],
    [3, 4, "c"],
  ]);
  // One cell remains after "abc"; the wide grapheme cannot fit it and
  // moves whole to the next row instead of being split.
  const narrow = ["abc\u4f60d"];
  const narrowLayout = buildVisualLayout(narrow, displaysOf(narrow), 4);
  assert.deepEqual(narrowLayout.rows.map((r) => [r.startCol, r.endCol, r.text]), [
    [0, 3, "abc"],
    [3, 5, "\u4f60d"],
  ]);
});

test("repeats the block prefix on continuation rows and slices spans row-locally", () => {
  const lines = ["aaaaaa bb"];
  const scans: DisplayScanLine[] = [
    { prefix: "> ", prefixStyle: "mdQuote", spans: [{ startCol: 5, endCol: 8, style: "match" }] },
  ];
  const layout = buildVisualLayout(lines, displaysOf(lines, scans), 8);
  assert.deepEqual(
    layout.rows.map((r) => [r.startCol, r.endCol, r.text, r.continuation, r.prefixWidth]),
    [
      [0, 6, "> aaaaaa", false, 2],
      [6, 9, ">  bb", true, 2],
    ],
  );
  // The prefix span paints both rows; the raw span crossing the break is
  // sliced into row-local display columns ([7,8) then [2,4)).
  assert.deepEqual(layout.rows.map((r) => r.spans), [
    [
      { start: 0, end: 2, style: "mdQuote" },
      { start: 7, end: 8, style: "match" },
    ],
    [
      { start: 0, end: 2, style: "mdQuote" },
      { start: 2, end: 4, style: "match" },
    ],
  ]);
});

test("emits one empty row for an empty logical line", () => {
  const lines = [""];
  const layout = buildVisualLayout(lines, displaysOf(lines), 10);
  assert.equal(layout.rows.length, 1);
  assert.deepEqual([layout.rows[0].line, layout.rows[0].startCol, layout.rows[0].endCol], [0, 0, 0]);
  assert.equal(layout.rows[0].text, "");
  assert.equal(layout.rows[0].continuation, false);
  assert.deepEqual(layout.firstRowByLine, [0]);
});

test("indexes the first row of every logical line", () => {
  const lines = ["aaaa bbbb", ""];
  const layout = buildVisualLayout(lines, displaysOf(lines), 4);
  assert.deepEqual(layout.firstRowByLine, [0, 3]);
});

test("clamps zero or narrow width to one content cell without splitting a wide grapheme", () => {
  const lines = ["abc"];
  for (const width of [0, 1]) {
    const layout = buildVisualLayout(lines, displaysOf(lines), width);
    assert.deepEqual(layout.rows.map((r) => [r.startCol, r.endCol]), [
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  }
  const wide = ["\u4f60ab"];
  const wideLayout = buildVisualLayout(wide, displaysOf(wide), 1);
  assert.deepEqual(wideLayout.rows.map((r) => [r.startCol, r.endCol]), [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  assert.equal(wideLayout.rows[0].text, "\u4f60"); // two cells on a one-cell row, never split
});

test("renders prefixes narrower, equal to, and wider than the viewport without losing raw text", () => {
  const lines = ["abcdef"];
  const narrower = buildVisualLayout(lines, displaysOf(lines, [{ prefix: "> " }]), 5);
  assert.deepEqual(narrower.rows.map((r) => [r.text, r.startCol, r.endCol, r.prefixWidth]), [
    ["> abc", 0, 3, 2],
    ["> def", 3, 6, 2],
  ]);
  // Prefix equal to the viewport: one prefix cell truncates so content
  // keeps its guaranteed cell.
  const equal = buildVisualLayout(lines, displaysOf(lines, [{ prefix: "> " }]), 2);
  assert.deepEqual(equal.rows.map((r) => [r.text, r.startCol, r.endCol, r.prefixWidth]), [
    [">a", 0, 1, 1],
    [">b", 1, 2, 1],
    [">c", 2, 3, 1],
    [">d", 3, 4, 1],
    [">e", 4, 5, 1],
    [">f", 5, 6, 1],
  ]);
  // Prefix wider than the viewport: truncated to the same one-cell budget.
  const wider = buildVisualLayout(lines, displaysOf(lines, [{ prefix: ">>> " }]), 2);
  assert.deepEqual(wider.rows.map((r) => [r.text, r.prefixWidth]), [
    [">a", 1],
    [">b", 1],
    [">c", 1],
    [">d", 1],
    [">e", 1],
    [">f", 1],
  ]);
  // One-cell viewport: the cosmetic prefix drops entirely, content stays.
  const oneCell = buildVisualLayout(lines, displaysOf(lines, [{ prefix: ">>> " }]), 1);
  const zeroWidth = buildVisualLayout(lines, displaysOf(lines, [{ prefix: ">>> " }]), 0);
  for (const layout of [oneCell, zeroWidth]) {
    assert.deepEqual(layout.rows.map((r) => [r.text, r.prefixWidth]), [
      ["a", 0],
      ["b", 0],
      ["c", 0],
      ["d", 0],
      ["e", 0],
      ["f", 0],
    ]);
  }
  for (const layout of [narrower, equal, wider, oneCell, zeroWidth]) {
    assert.equal(layout.rows.map((r) => lines[0].slice(r.startCol, r.endCol)).join(""), lines[0]);
  }
  // Mapping round-trips through cosmetically truncated prefix rows.
  assert.deepEqual(toVisualPosition(lines, equal, { line: 0, col: 3 }), { row: 3, col: 1 });
  assert.deepEqual(toRawPosition(lines, equal, 3, 1), { line: 0, col: 3 });
});

test("concatenating raw row slices reproduces every original line byte-for-byte", () => {
  const lines = [
    "plain ascii text that wraps a few times across a narrow viewport",
    "\u4f60\u597d\u4e16\u754c mixed \ud83d\ude00 wide",
    "tabbed\tcolumns\tafter",
    "punct, ends; here?",
    "",
    "\ud834\udd1e astral note",
  ];
  const scans: (DisplayScanLine | undefined)[] = [
    undefined,
    { prefix: "> ", prefixStyle: "mdQuote" },
    undefined,
    { prefix: "| ", prefixStyle: "mdQuote" },
    undefined,
    undefined,
  ];
  for (const width of [1, 3, 8, 20]) {
    const layout = buildVisualLayout(lines, displaysOf(lines, scans), width);
    assert.ok(layout.rows.length >= lines.length, `at least one row per line at width ${width}`);
    lines.forEach((raw, line) => {
      const joined = layout.rows
        .filter((r) => r.line === line)
        .map((r) => raw.slice(r.startCol, r.endCol))
        .join("");
      assert.equal(joined, raw, `line ${line} at width ${width}`);
    });
  }
});

test("computes maxLineWidth from the unwrapped display lines", () => {
  const lines = ["ab", "abcdef", "a\tb"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 3);
  assert.equal(layout.maxLineWidth, 6); // "abcdef"; "a\tb" expands to 5
});

test("maps an intermediate break boundary to the start of the following row", () => {
  const lines = ["alpha beta gamma"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 10);
  // Raw column 6 sits on the break: the space stays on row 0 and the
  // boundary position renders at the start of row 1.
  assert.deepEqual(toVisualPosition(lines, layout, { line: 0, col: 6 }), { row: 1, col: 0 });
  assert.deepEqual(toRawPosition(lines, layout, 1, 0), { line: 0, col: 6 });
  // The trailing space itself still maps inside row 0.
  assert.deepEqual(toVisualPosition(lines, layout, { line: 0, col: 5 }), { row: 0, col: 5 });
  assert.deepEqual(toRawPosition(lines, layout, 0, 5), { line: 0, col: 5 });
});

test("maps display columns inside the prefix to the row start column and clamps the row end", () => {
  const lines = ["abcdef"];
  const layout = buildVisualLayout(lines, displaysOf(lines, [{ prefix: "> " }]), 20);
  assert.deepEqual(toRawPosition(lines, layout, 0, 0), { line: 0, col: 0 });
  assert.deepEqual(toRawPosition(lines, layout, 0, 1), { line: 0, col: 0 });
  assert.deepEqual(toRawPosition(lines, layout, 0, 2), { line: 0, col: 0 }); // first content cell
  assert.deepEqual(toRawPosition(lines, layout, 0, 99), { line: 0, col: 6 }); // clamps to row end
  assert.deepEqual(toVisualPosition(lines, layout, { line: 0, col: 0 }), { row: 0, col: 2 });
  assert.deepEqual(toVisualPosition(lines, layout, { line: 0, col: 6 }), { row: 0, col: 8 }); // logical EOL
});

test("round-trips boundary columns through skin-tone and ZWJ emoji clusters", () => {
  // The skin-tone modifier joins its base into one four-unit cluster, so
  // raw column 4 is the boundary between the cluster and "x".
  const lines = ["\u{1F44D}\u{1F3FD}x"];
  const layout = buildVisualLayout(lines, displaysOf(lines), 20);
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0].text, lines[0]);
  assert.deepEqual(toVisualPosition(lines, layout, { line: 0, col: 4 }), { row: 0, col: 2 });
  assert.deepEqual(toRawPosition(lines, layout, 0, 2), { line: 0, col: 4 });
  // The ZWJ family is one eight-unit cluster; raw column 8 ends it.
  const family = ["\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x"];
  const familyLayout = buildVisualLayout(family, displaysOf(family), 20);
  assert.equal(familyLayout.rows.length, 1);
  assert.equal(familyLayout.rows[0].text, family[0]);
  assert.deepEqual(toVisualPosition(family, familyLayout, { line: 0, col: 8 }), { row: 0, col: 2 });
  assert.deepEqual(toRawPosition(family, familyLayout, 0, 2), { line: 0, col: 8 });
});

test("wraps Indic clusters whole so every cluster renders and slices stay lossless", () => {
  const lines = ["\u0915\u093F".repeat(4)];
  const layout = buildVisualLayout(lines, displaysOf(lines), 4);
  assert.deepEqual(layout.rows.map((r) => [r.startCol, r.endCol]), [
    [0, 4],
    [4, 8],
  ]);
  // Each row renders both of its clusters: two per row at two columns each.
  assert.deepEqual(layout.rows.map((r) => r.text), ["\u0915\u093F\u0915\u093F", "\u0915\u093F\u0915\u093F"]);
  assert.equal(layout.rows.map((r) => lines[0].slice(r.startCol, r.endCol)).join(""), lines[0]);
  for (const col of [0, 2, 4, 6, 8]) {
    const visual = toVisualPosition(lines, layout, { line: 0, col });
    assert.deepEqual(toRawPosition(lines, layout, visual.row, visual.col), { line: 0, col });
  }
});

test("round-trips every multi-code-point cluster boundary across widths", () => {
  const lines = [
    "\u{1F44D}\u{1F3FD}x",
    "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x",
    "\u0915\u093F".repeat(4),
  ];
  const boundaries = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const width of [1, 2, 3, 5, 9, 20]) {
    const layout = buildVisualLayout(lines, displaysOf(lines), width);
    lines.forEach((raw, line) => {
      const joined = layout.rows
        .filter((r) => r.line === line)
        .map((r) => raw.slice(r.startCol, r.endCol))
        .join("");
      assert.equal(joined, raw, `lossless line ${line} at width ${width}`);
      const stops = new Set<number>([0, raw.length]);
      for (const seg of boundaries.segment(raw)) stops.add(seg.index);
      for (const col of stops) {
        const visual = toVisualPosition(lines, layout, { line, col });
        assert.deepEqual(toRawPosition(lines, layout, visual.row, visual.col), { line, col }, `line ${line} col ${col} width ${width}`);
      }
    });
  }
});

test("keeps row text, widths, and mappings in one display-space geometry across Indic, emoji, and tabs", () => {
  // Indic spacing-mark clusters plus a skin-tone emoji before a tab: the
  // emoji's code points each count toward tui/display's tab expansion while
  // the whole cluster renders at its whole-cluster width, so the row walk
  // must width graphemes exactly as they occupy display.text.
  const raw = "\u0915\u093F mix \u{1F44D}\u{1F3FD} tab\there";
  const display = buildDisplayLine(raw);
  const boundaries = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // Ground truth for row text slicing: lockstep-aligns raw's grapheme
  // clusters with display.text's clusters (non-tab clusters match
  // one-for-one; each raw tab consumes its run of expanded spaces) and
  // joins the display.text clusters a row's raw range must render.
  const expectedRowText = (startCol: number, endCol: number): string => {
    const raws = Array.from(boundaries.segment(raw));
    const texts = Array.from(boundaries.segment(display.text));
    let t = 0;
    let out = "";
    let collecting = false;
    for (const seg of raws) {
      if (seg.index >= endCol) break;
      if (seg.index >= startCol) collecting = true;
      if (seg.segment === "\t") {
        while (t < texts.length && texts[t].segment === " ") {
          if (collecting) out += texts[t].segment;
          t++;
        }
      } else {
        if (collecting) out += texts[t].segment;
        t++;
      }
    }
    return out;
  };
  for (const width of [0, 1, 2, 3, 5, 6, 8, 20]) {
    const layout = buildVisualLayout([raw], [display], width);
    const rows = layout.rows;
    // Raw slices concatenate losslessly.
    assert.equal(
      rows.map((r) => raw.slice(r.startCol, r.endCol)).join(""),
      raw,
      `lossless raw slices at width ${width}`,
    );
    for (const r of rows) {
      // No raw-advancing row renders empty.
      if (r.startCol < r.endCol) {
        assert.ok(r.text.length > 0, `row [${r.startCol}, ${r.endCol}) renders at width ${width}`);
      }
      // Each row's text is its raw slice with the globally expanded tabs.
      assert.equal(r.text, expectedRowText(r.startCol, r.endCol), `row [${r.startCol}, ${r.endCol}) text at width ${width}`);
    }
    // Every cluster renders: the rows tile the display line exactly.
    assert.equal(rows.map((r) => r.text).join(""), display.text, `rows tile display.text at width ${width}`);
    // Exact boundary round trips in both mapping directions.
    const stops = new Set<number>([0, raw.length]);
    for (const seg of boundaries.segment(raw)) stops.add(seg.index);
    for (const col of stops) {
      const visual = toVisualPosition([raw], layout, { line: 0, col });
      assert.deepEqual(
        toRawPosition([raw], layout, visual.row, visual.col),
        { line: 0, col },
        `boundary ${col} round trip at width ${width}`,
      );
    }
  }
});

test("round-trips raw positions through visual rows across tabs, prefixes, astral chars, and EOL", () => {
  const lines = [
    "alpha beta gamma delta",
    "tabbed\tvalue here",
    "\u4f60\u597d \ud83d\ude00 world",
  ];
  const scans: (DisplayScanLine | undefined)[] = [
    undefined,
    { prefix: "> ", prefixStyle: "mdQuote" },
    undefined,
  ];
  const layout = buildVisualLayout(lines, displaysOf(lines, scans), 10);
  const boundaries = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  lines.forEach((raw, line) => {
    const stops = new Set<number>([0, raw.length]);
    for (const seg of boundaries.segment(raw)) stops.add(seg.index);
    for (const col of stops) {
      const visual = toVisualPosition(lines, layout, { line, col });
      assert.ok(visual.row >= 0 && visual.row < layout.rows.length, `row bounds for ${line}:${col}`);
      const back = toRawPosition(lines, layout, visual.row, visual.col);
      assert.deepEqual(back, { line, col }, `round trip line ${line} col ${col}`);
    }
  });
});
