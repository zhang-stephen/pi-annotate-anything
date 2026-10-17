import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth, type EditorComponent } from "@earendil-works/pi-tui";
import { recolorTokens, withTokenRecolor } from "../src/editor.ts";

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

test("withTokenRecolor decorates render output and returns the same instance", () => {
  const base = {
    renderCalls: 0,
    render(_width: number): string[] {
      this.renderCalls += 1;
      return ["annotate [src/a.ts:1-2] please", "plain"];
    },
  };
  const tokens = ["[src/a.ts:1-2]"];
  const decorated = withTokenRecolor(base as unknown as EditorComponent, () => tokens);
  assert.equal(decorated, base); // same instance, predecessor preserved
  const lines = decorated.render(80);
  assert.equal(lines[0], `annotate ${inverse("[src/a.ts:1-2]")} please`);
  assert.equal(lines[1], "plain");
  assert.equal(base.renderCalls, 1); // base render still drives the output
});

test("withTokenRecolor passes lines through when no tokens are pending", () => {
  const original = ["nothing to recolor"];
  const base = { render: (_width: number) => [...original] };
  const decorated = withTokenRecolor(base as unknown as EditorComponent, () => []);
  assert.deepEqual(decorated.render(80), original);
});
