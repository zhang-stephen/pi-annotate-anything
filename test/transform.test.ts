import { test } from "node:test";
import assert from "node:assert/strict";

import { AnnotationStore } from "../src/store.ts";
import { formatPayload, tokenLabel } from "../src/message.ts";
import { expandTokens } from "../src/transform.ts";
import type { Range, VisualMode } from "../src/selection.ts";

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
