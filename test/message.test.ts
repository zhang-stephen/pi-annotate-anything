import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rangeLabel,
  displayPath,
  tokenLabel,
  formatPayload,
} from "../src/message.ts";
import type { Range, VisualMode } from "../src/selection.ts";

function range(
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): Range {
  return { startLine, startCol, endLine, endCol };
}

test("rangeLabel: line-wise multi-line is 1-based inclusive", () => {
  assert.equal(rangeLabel(range(9, 0, 19, 40), "line"), "lines 10-20");
});

test("rangeLabel: line-wise single line collapses", () => {
  assert.equal(rangeLabel(range(9, 0, 9, 12), "line"), "lines 10");
});

test("rangeLabel: char-wise multi-line shows 1-based lines and columns", () => {
  assert.equal(rangeLabel(range(9, 4, 11, 19), "char"), "lines 10:5-12:19");
});

test("rangeLabel: char-wise single line keeps columns", () => {
  assert.equal(rangeLabel(range(9, 4, 9, 11), "char"), "lines 10:5-10:11");
});

test("displayPath: file inside cwd is relative without leading ./", () => {
  assert.equal(displayPath("/repo/src/a.ts", "/repo"), "src/a.ts");
});

test("displayPath: file directly in cwd has no directory part", () => {
  assert.equal(displayPath("/repo/a.ts", "/repo"), "a.ts");
});

test("displayPath: cwd itself falls back to the absolute path", () => {
  assert.equal(displayPath("/repo", "/repo"), "/repo");
});

test("displayPath: file outside cwd stays absolute", () => {
  assert.equal(displayPath("/etc/hosts", "/repo"), "/etc/hosts");
});

test("displayPath: sibling directory with shared prefix stays absolute", () => {
  assert.equal(displayPath("/repository/a.ts", "/repo"), "/repository/a.ts");
});

test("displayPath: path with spaces is preserved verbatim", () => {
  assert.equal(displayPath("/repo/my docs/a file.ts", "/repo"), "my docs/a file.ts");
});

test("tokenLabel: line-wise multi-line uses the compact range", () => {
  assert.equal(tokenLabel("/repo/src/a.ts", "/repo", range(9, 0, 19, 40), "line"), "[src/a.ts:10-20]");
});

test("tokenLabel: line-wise single line has one number", () => {
  assert.equal(tokenLabel("/repo/src/a.ts", "/repo", range(9, 0, 9, 12), "line"), "[src/a.ts:10]");
});

test("tokenLabel: char-wise multi-line uses line:col pairs", () => {
  assert.equal(tokenLabel("/repo/src/a.ts", "/repo", range(9, 4, 11, 19), "char"), "[src/a.ts:10:5-12:19]");
});

test("tokenLabel: char-wise single line keeps columns", () => {
  assert.equal(tokenLabel("/repo/src/a.ts", "/repo", range(9, 4, 9, 11), "char"), "[src/a.ts:10:5-10:11]");
});

test("tokenLabel: file outside cwd uses the absolute path", () => {
  assert.equal(tokenLabel("/etc/hosts", "/repo", range(9, 0, 19, 0), "line"), "[/etc/hosts:10-20]");
});

test("formatPayload: char-wise payload with comment matches the layout", () => {
  const payload = formatPayload({
    absPath: "/repo/src/a.ts",
    cwd: "/repo",
    range: range(9, 4, 11, 19),
    mode: "char",
    snapshot: "alpha\nbeta\ngamma\n",
    comment: "watch this",
  });
  assert.equal(
    payload,
    [
      "In `src/a.ts` (lines 10:5-12:19):",
      "```ts",
      "alpha",
      "beta",
      "gamma",
      "```",
      "Comment: watch this",
    ].join("\n"),
  );
});

test("formatPayload: omits the Comment line when the comment is empty", () => {
  const payload = formatPayload({
    absPath: "/repo/src/a.ts",
    cwd: "/repo",
    range: range(9, 0, 10, 3),
    mode: "line",
    snapshot: "alpha\nbeta",
    comment: "",
  });
  assert.equal(
    payload,
    [
      "In `src/a.ts` (lines 10-11):",
      "```ts",
      "alpha",
      "beta",
      "```",
    ].join("\n"),
  );
});

test("formatPayload: strips one trailing snapshot newline before the closing fence", () => {
  const payload = formatPayload({
    absPath: "/repo/a.ts",
    cwd: "/repo",
    range: range(0, 0, 0, 4),
    mode: "line",
    snapshot: "alpha\n",
    comment: "",
  });
  assert.equal(payload, "In `a.ts` (lines 1):\n```ts\nalpha\n```");
});

test("formatPayload: language tag comes from the file extension", () => {
  const payload = formatPayload({
    absPath: "/repo/a.py",
    cwd: "/repo",
    range: range(0, 0, 0, 1),
    mode: "line",
    snapshot: "x",
    comment: "",
  });
  assert.equal(payload, "In `a.py` (lines 1):\n```python\nx\n```");
});

test("formatPayload: unknown extension yields a plain fence", () => {
  const payload = formatPayload({
    absPath: "/repo/a.xyz",
    cwd: "/repo",
    range: range(0, 0, 0, 1),
    mode: "line",
    snapshot: "x",
    comment: "",
  });
  assert.equal(payload, "In `a.xyz` (lines 1):\n```\nx\n```");
});

test("formatPayload: file outside cwd shows the absolute path in the header", () => {
  const payload = formatPayload({
    absPath: "/etc/hosts",
    cwd: "/repo",
    range: range(0, 0, 0, 1),
    mode: "line",
    snapshot: "x",
    comment: "n/a",
  });
  assert.equal(payload, "In `/etc/hosts` (lines 1):\n```\nx\n```\nComment: n/a");
});
