import { test } from "node:test";
import assert from "node:assert/strict";

import { AnnotationStore } from "../../src/core/store.ts";
import { formatPayload, tokenLabel } from "../../src/core/message.ts";
import { expandTokens, findTokenMatches, lastTokenIn } from "../../src/core/transform.ts";
import type { Range, VisualMode } from "../../src/core/selection.ts";

const CWD = "/repo";

function range(startLine: number, endLine: number): Range {
  return { startLine, startCol: 0, endLine, endCol: 40 };
}

function draft(opts: {
  absPath: string;
  startLine: number;
  endLine: number;
  snapshot: string;
  comment: string;
  mode?: VisualMode;
}) {
  return {
    absPath: opts.absPath,
    range: range(opts.startLine, opts.endLine),
    mode: opts.mode ?? "line",
    snapshot: opts.snapshot,
    comment: opts.comment,
  };
}

function added(store: AnnotationStore, opts: Parameters<typeof draft>[0]) {
  const base = tokenLabel(opts.absPath, CWD, range(opts.startLine, opts.endLine), opts.mode ?? "line");
  return store.add(draft(opts), base);
}

function payloadFor(opts: Parameters<typeof draft>[0], cwd: string): string {
  return formatPayload({ ...draft(opts), cwd });
}

test("expandTokens: single token mid-prose expands to the payload block", () => {
  const store = new AnnotationStore();
  const opts = {
    absPath: "/repo/src/a.ts",
    startLine: 9,
    endLine: 19,
    snapshot: "const a = 1;\nconst b = 2;\n",
    comment: "why is this duplicated?",
  };
  const d = added(store, opts);
  const payload = payloadFor(opts, CWD);

  const result = expandTokens(`Look at ${d.token} please.`, store, CWD);

  assert.deepEqual(result, { changed: true, text: `Look at\n\n${payload}\n\n please.` });
});

test("expandTokens: multiple tokens expand in order", () => {
  const store = new AnnotationStore();
  const first = {
    absPath: "/repo/src/a.ts",
    startLine: 9,
    endLine: 19,
    snapshot: "line ten\nline twenty\n",
    comment: "first issue",
  };
  const second = {
    absPath: "/repo/src/b.py",
    startLine: 4,
    endLine: 4,
    snapshot: "def broken(): pass\n",
    comment: "",
  };
  const d1 = added(store, first);
  const d2 = added(store, second);
  const p1 = payloadFor(first, CWD);
  const p2 = payloadFor(second, CWD);

  const result = expandTokens(`a ${d1.token} b ${d2.token} c`, store, CWD);

  assert.equal(result.changed, true);
  const expected = `a\n\n${p1}\n\n b\n\n${p2}\n\n c`;
  assert.equal(result.text, expected);
  assert.ok(result.text.indexOf(p1) < result.text.indexOf(p2));
});

test("expandTokens: token-like text not in the store stays untouched", () => {
  const store = new AnnotationStore();
  added(store, {
    absPath: "/repo/src/a.ts",
    startLine: 9,
    endLine: 19,
    snapshot: "line\n",
    comment: "",
  });

  const text = "the user typed [other.ts:1-2] by hand";
  const result = expandTokens(text, store, CWD);

  assert.deepEqual(result, { changed: false, text });
});

test("expandTokens: tokens with regex-special characters are escaped", () => {
  const store = new AnnotationStore();
  const opts = {
    absPath: "/repo/my.file[1].ts",
    startLine: 2,
    endLine: 2,
    snapshot: "x = 1;\n",
    comment: "",
  };
  const d = added(store, opts);
  const payload = payloadFor(opts, CWD);

  const result = expandTokens(`see ${d.token} now`, store, CWD);

  assert.deepEqual(result, { changed: true, text: `see\n\n${payload}\n\n now` });
});

test("expandTokens: text without tokens returns unchanged", () => {
  const store = new AnnotationStore();
  added(store, {
    absPath: "/repo/src/a.ts",
    startLine: 9,
    endLine: 19,
    snapshot: "line\n",
    comment: "",
  });

  const text = "no annotations mentioned in this message";
  const result = expandTokens(text, store, CWD);

  assert.deepEqual(result, { changed: false, text });
});

test("expandTokens: expansion is blank-line separated and trims preceding whitespace", () => {
  const store = new AnnotationStore();
  const opts = {
    absPath: "/repo/src/a.ts",
    startLine: 9,
    endLine: 19,
    snapshot: "line\n",
    comment: "",
  };
  const d = added(store, opts);
  const payload = payloadFor(opts, CWD);

  const result = expandTokens(`before   ${d.token}after`, store, CWD);

  assert.deepEqual(result, { changed: true, text: `before\n\n${payload}\n\nafter` });
});

test("expandTokens: longest token wins when one token is a prefix of another", () => {
  const store = new AnnotationStore();
  // Prefix pair crafted via explicit base tokens (real tokenLabel output is
  // never a strict prefix of another token): the short token added first
  // must not shadow the longer one in the alternation.
  const short = store.add(
    { absPath: "/repo/src/a.ts", range: range(9, 19), mode: "line", snapshot: "short\n", comment: "" },
    "[src/a.ts:10-20]",
  );
  const long = store.add(
    { absPath: "/repo/src/b.ts", range: range(0, 4), mode: "line", snapshot: "long\n", comment: "" },
    "[src/a.ts:10-20] long]",
  );
  const pLong = formatPayload({
    absPath: long.absPath,
    cwd: CWD,
    range: long.range,
    mode: long.mode,
    snapshot: long.snapshot,
    comment: long.comment,
  });

  const result = expandTokens(`see ${long.token} now`, store, CWD);

  assert.equal(result.changed, true);
  assert.equal(result.text, `see\n\n${pLong}\n\n now`);
});

// findTokenMatches / lastTokenIn (alt+o jump-back selection) -----------------

test("findTokenMatches locates every occurrence left to right with its index", () => {
  const matches = findTokenMatches("a [b.ts:1-2] c [a.ts:1-2] d", ["[a.ts:1-2]", "[b.ts:1-2]"]);
  assert.deepEqual(matches, [
    { token: "[b.ts:1-2]", index: 2 },
    { token: "[a.ts:1-2]", index: 15 },
  ]);
});

test("findTokenMatches returns no matches for absent tokens or an empty token list", () => {
  assert.deepEqual(findTokenMatches("no pills here", ["[a.ts:1-2]"]), []);
  assert.deepEqual(findTokenMatches("[a.ts:1-2]", []), []);
});

test("findTokenMatches: a prefix token does not shadow its longer form", () => {
  // Longest-first alternation: at the long token's position the whole long
  // token matches, never its shorter prefix.
  const matches = findTokenMatches("see [a.ts:1-2] and [a.ts:1-2 ~2]", ["[a.ts:1-2]", "[a.ts:1-2 ~2]"]);
  assert.deepEqual(matches, [
    { token: "[a.ts:1-2]", index: 4 },
    { token: "[a.ts:1-2 ~2]", index: 19 },
  ]);
});

test("lastTokenIn picks the rightmost occurrence of a mixed buffer", () => {
  const tokens = ["[a.ts:1-2]", "[b.ts:3-4]"];
  assert.deepEqual(lastTokenIn(`fix [a.ts:1-2] then recheck [b.ts:3-4] done`, tokens), {
    token: "[b.ts:3-4]",
    index: 28,
  });
  // Same token twice: the later occurrence wins (most recent attachment).
  assert.deepEqual(lastTokenIn("[a.ts:1-2] ... [a.ts:1-2]", tokens), { token: "[a.ts:1-2]", index: 15 });
});

test("lastTokenIn returns null when no token occurs in the text", () => {
  assert.equal(lastTokenIn("plain prose only", ["[a.ts:1-2]", "[b.ts:3-4]"]), null);
  assert.equal(lastTokenIn("anything", []), null);
  // Token-like text that matches no listed token is not a match.
  assert.equal(lastTokenIn("see [c.ts:9-9] here", ["[a.ts:1-2]"]), null);
});
