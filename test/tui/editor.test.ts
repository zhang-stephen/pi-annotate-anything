import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth, type EditorComponent } from "@earendil-works/pi-tui";
import { recolorTokens, withComposerJumpBack, withTokenRecolor } from "../../src/tui/editor.ts";

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

// withComposerJumpBack (alt+o proxy) -----------------------------------------

interface InputSpy {
  received: string[];
}

// Minimal EditorComponent stand-in that records every forwarded chunk.
function inputEditor(spy: InputSpy, text: () => string): EditorComponent {
  return {
    render: () => [],
    getText: text,
    setText: () => {},
    handleInput: (data: string) => {
      spy.received.push(data);
    },
    invalidate: () => {},
  };
}

const ALT_O = "\x1bo"; // legacy ESC-o encoding of alt+o

test("withComposerJumpBack intercepts alt+o before the inner editor and reports the last token", () => {
  const spy: InputSpy = { received: [] };
  const base = inputEditor(spy, () => "check [a.ts:1-2] and [b.ts:3-4]");
  const jumps: string[] = [];
  const wrapped = withComposerJumpBack(base, () => ["[a.ts:1-2]", "[b.ts:3-4]"], (t) => jumps.push(t), () => {});

  assert.equal(wrapped, base); // same instance, predecessor preserved
  wrapped.handleInput(ALT_O);
  assert.deepEqual(jumps, ["[b.ts:3-4]"], "the LAST token in the buffer is the jump target");
  assert.deepEqual(spy.received, [], "the inner editor must not see an intercepted alt+o");
});

test("withComposerJumpBack recognizes the kitty CSI-u alt+o form through parseKey", () => {
  const spy: InputSpy = { received: [] };
  const base = inputEditor(spy, () => "[a.ts:1-2]");
  const jumps: string[] = [];
  const wrapped = withComposerJumpBack(base, () => ["[a.ts:1-2]"], (t) => jumps.push(t), () => {});

  wrapped.handleInput("\x1b[111;3u");
  assert.deepEqual(jumps, ["[a.ts:1-2]"]);
  assert.deepEqual(spy.received, []);
});

test("withComposerJumpBack swallows alt+o and calls onMiss when no token is in the buffer", () => {
  const spy: InputSpy = { received: [] };

  // No live tokens at all.
  const empty = inputEditor(spy, () => "plain text");
  const emptyJumps: string[] = [];
  const emptyMisses: number[] = [];
  withComposerJumpBack(empty, () => [], (t) => emptyJumps.push(t), () => emptyMisses.push(1)).handleInput(ALT_O);
  assert.deepEqual(emptyJumps, []);
  assert.deepEqual(emptyMisses, [1], "the miss callback fires exactly once");
  assert.deepEqual(spy.received, [], "the swallowed alt+o never reaches the inner editor");

  // A live token exists but the buffer lost its pill: still a miss.
  spy.received.length = 0;
  const unlisted = inputEditor(spy, () => "token was deleted");
  const unlistedJumps: string[] = [];
  const unlistedMisses: number[] = [];
  withComposerJumpBack(unlisted, () => ["[a.ts:1-2]"], (t) => unlistedJumps.push(t), () => unlistedMisses.push(1)).handleInput(
    ALT_O,
  );
  assert.deepEqual(unlistedJumps, []);
  assert.deepEqual(unlistedMisses, [1]);
  assert.deepEqual(spy.received, [], "a miss never forwards alt+o to the inner editor");
});

test("withComposerJumpBack forwards every non-alt+o chunk unchanged, including a lone Esc", () => {
  const spy: InputSpy = { received: [] };
  const base = inputEditor(spy, () => "[a.ts:1-2]");
  const jumps: string[] = [];
  const misses: number[] = [];
  const wrapped = withComposerJumpBack(base, () => ["[a.ts:1-2]"], (t) => jumps.push(t), () => misses.push(1));

  const chunks = [
    "x",
    "\x1b", // lone Esc: parseKey says "escape", never alt+o
    "\x1b[A", // arrow up
    "\r",
    "\x1b[200~multi byte paste\x1b[201~", // bracketed paste
    "hello", // multi-character text chunk
    "\x1b[111u", // kitty CSI-u WITHOUT alt (plain o): must not be hijacked
  ];
  for (const chunk of chunks) wrapped.handleInput(chunk);
  assert.deepEqual(spy.received, chunks, "each chunk reaches the inner editor byte-identical");
  assert.deepEqual(jumps, []);
  assert.deepEqual(misses, [], "non-alt+o chunks never trigger the miss callback");
});
