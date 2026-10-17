import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { recolorTokens } from "../src/editor.ts";

// Visible marker wrapper for content assertions (per task brief).
const marker = (s: string) => `<${s}>`;
// ANSI inverse-video wrapper for width-preserving assertions (per controller ruling).
const inverse = (s: string) => `\x1b[7m${s}\x1b[27m`;

test("recolorTokens wraps a found token with the style", () => {
  assert.equal(recolorTokens("see src/foo.ts here", ["src/foo.ts"], marker), "see <src/foo.ts> here");
});

test("recolorTokens leaves text without tokens untouched", () => {
  assert.equal(recolorTokens("plain text", ["src/foo.ts"], marker), "plain text");
});

test("recolorTokens recolors every token occurrence", () => {
  assert.equal(recolorTokens("a b", ["a", "b"], marker), "<a> <b>");
  assert.equal(recolorTokens("a a", ["a"], marker), "<a> <a>");
});

test("recolorTokens preserves ANSI visible width", () => {
  const line = "annotate src/foo.ts now";
  const recolored = recolorTokens(line, ["src/foo.ts"], inverse);
  assert.equal(visibleWidth(recolored), visibleWidth(line));
  // Stripping the escapes must yield the original line.
  assert.equal(recolored.replace(/\x1b\[[0-9;]*m/g, ""), line);
});

test("recolorTokens returns the input unchanged when no token matches", () => {
  const line = "nothing matches";
  assert.equal(recolorTokens(line, ["a.txt", "b.txt"], marker), line);
});

test("recolorTokens: prefix token does not shadow its longer form", () => {
  const line = "see [a.ts:1-2] and [a.ts:1-2 ~2]";
  const out = recolorTokens(line, ["[a.ts:1-2]", "[a.ts:1-2 ~2]"], marker);
  assert.equal(out, "see <[a.ts:1-2]> and <[a.ts:1-2 ~2]>");
});
