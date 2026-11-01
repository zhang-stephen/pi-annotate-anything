import { test } from "node:test";
import assert from "node:assert/strict";

import { applyStyleSpans } from "../../src/viewer/line-style.ts";
import type { DisplayStyle } from "../../src/viewer/line-style.ts";

// Paint helpers tag wrapped segments with plain markers so tests assert
// composition and precedence exactly, not ANSI bytes.
const paint = {
  inverse: (s: string) => `<v>${s}</v>`,
  target: (s: string) => `<t>${s}</t>`,
  dimUnderline: (s: string) => `<d>${s}</d>`,
  match: (s: string) => `<m>${s}</m>`,
  mdBold: (s: string) => `<b>${s}</b>`,
  mdItalic: (s: string) => `<i>${s}</i>`,
  mdStrike: (s: string) => `<s>${s}</s>`,
  mdCode: (s: string) => `<c>${s}</c>`,
} satisfies Partial<Record<DisplayStyle, (s: string) => string>>;

test("markdown styles compose with target emphasis instead of entering the precedence race", () => {
  const line = applyStyleSpans(
    "hello",
    [
      { start: 0, end: 5, style: "target" },
      { start: 2, end: 3, style: "mdBold" },
    ],
    paint,
  );
  assert.equal(line, `<t>he</t><b><t>l</t></b><t>lo</t>`);
});

test("markdown styles survive the target-over-dimUnderline suppression that drops viewer emphases", () => {
  const line = applyStyleSpans(
    "hello",
    [
      { start: 0, end: 5, style: "target" },
      { start: 2, end: 3, style: "dimUnderline" },
      { start: 2, end: 3, style: "mdItalic" },
    ],
    paint,
  );
  // dimUnderline loses to target exactly as before; mdItalic still paints.
  // The painter wraps each boundary segment separately, and a later span
  // nests around an earlier one (additive SGR, order is cosmetic).
  assert.equal(line, "<t>he</t><i><t>l</t></i><t>lo</t>");
});

test("legacy emphasis precedence is unchanged when no markdown style is active", () => {
  const line = applyStyleSpans(
    "hello",
    [
      { start: 0, end: 5, style: "target" },
      { start: 2, end: 3, style: "dimUnderline" },
    ],
    paint,
  );
  // Same per-segment wrapping the painter produced before Markdown styles
  // existed; only the strongest emphasis appears on every cell.
  assert.equal(line, "<t>he</t><t>l</t><t>lo</t>");
});

test("markdown styles compose with dimUnderline when it is the strongest emphasis", () => {
  const line = applyStyleSpans(
    "abcde",
    [
      { start: 0, end: 5, style: "dimUnderline" },
      { start: 2, end: 4, style: "mdStrike" },
    ],
    paint,
  );
  assert.equal(line, "<d>ab</d><s><d>cd</d></s><d>e</d>");
});

test("markdown styles compose with search matches", () => {
  const line = applyStyleSpans(
    "abcd",
    [
      { start: 0, end: 2, style: "match" },
      { start: 1, end: 3, style: "mdCode" },
    ],
    paint,
  );
  assert.equal(line, `<m>a</m><c><m>b</m></c><c>c</c>d`);
});

test("markdown styles compose with inverse selection", () => {
  const line = applyStyleSpans(
    "abc",
    [
      { start: 0, end: 3, style: "inverse" },
      { start: 1, end: 2, style: "mdBold" },
    ],
    paint,
  );
  assert.equal(line, `<v>a</v><b><v>b</v></b><v>c</v>`);
});

test("a markdown style without a registered paint degrades to plain text", () => {
  const legacyOnly: Partial<Record<DisplayStyle, (s: string) => string>> = { inverse: paint.inverse };
  const line = applyStyleSpans(
    "abc",
    [
      { start: 0, end: 3, style: "inverse" },
      { start: 1, end: 2, style: "mdBold" },
    ],
    legacyOnly,
  );
  assert.equal(line, `${paint.inverse("a")}${paint.inverse("b")}${paint.inverse("c")}`);
});
