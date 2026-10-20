import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolvePath, loadFile, extractRange } from "../../src/core/file-range.ts";
import type { Range } from "../../src/core/selection.ts";

const MIB = 1024 * 1024;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "file-range-test-"));
}

function write(dir: string, name: string, content: string | Buffer): string {
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}

function withTempDir(run: (dir: string) => void): void {
  const dir = makeTempDir();
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolvePath: tilde resolves to the home directory", () => {
  assert.equal(resolvePath("~", "/tmp"), os.homedir());
});

test("resolvePath: tilde-prefixed path joins onto home", () => {
  assert.equal(resolvePath("~/notes.txt", "/tmp"), path.join(os.homedir(), "notes.txt"));
});

test("resolvePath: relative path resolves against cwd", () => {
  assert.equal(resolvePath("src/foo.ts", "/tmp/work"), path.resolve("/tmp/work", "src/foo.ts"));
});

test("resolvePath: absolute path passes through unchanged", () => {
  assert.equal(resolvePath("/tmp/work/a.txt", "/elsewhere"), "/tmp/work/a.txt");
});

test("loadFile: normalizes CRLF to LF and drops the trailing newline", () => {
  withTempDir((dir) => {
    const file = write(dir, "crlf.txt", "alpha\r\nbeta\r\ngamma\r\n");
    const result = loadFile(file);
    assert.ok(result.ok);
    assert.equal(result.path, file);
    assert.deepEqual(result.lines, ["alpha", "beta", "gamma"]);
  });
});

test("loadFile: keeps interior empty lines and handles missing trailing newline", () => {
  withTempDir((dir) => {
    const file = write(dir, "mixed.txt", "a\n\nb");
    const result = loadFile(file);
    assert.ok(result.ok);
    assert.deepEqual(result.lines, ["a", "", "b"]);
  });
});

test("loadFile: empty file yields zero lines", () => {
  withTempDir((dir) => {
    const file = write(dir, "empty.txt", "");
    const result = loadFile(file);
    assert.ok(result.ok);
    assert.deepEqual(result.lines, []);
  });
});

test("loadFile: tab and wide-char content extracted byte-faithfully", () => {
  withTempDir((dir) => {
    const file = write(dir, "wide.txt", "col:\t\u4f60\u597d\nnext\u{1F600}line");
    const result = loadFile(file);
    assert.ok(result.ok);
    assert.deepEqual(result.lines, ["col:\t\u4f60\u597d", "next\u{1F600}line"]);
    const range: Range = { startLine: 0, startCol: 4, endLine: 1, endCol: 6 };
    assert.equal(extractRange(result.lines, range), "\t\u4f60\u597d\nnext\u{1F600}");
  });
});

test("loadFile: missing file reports not-found", () => {
  withTempDir((dir) => {
    assert.deepEqual(loadFile(path.join(dir, "nope.txt")), { ok: false, reason: "not-found" });
  });
});

test("loadFile: directory reports is-directory", () => {
  withTempDir((dir) => {
    assert.deepEqual(loadFile(dir), { ok: false, reason: "is-directory" });
  });
});

test("loadFile: NUL byte marks the file binary", () => {
  withTempDir((dir) => {
    const file = write(dir, "blob.bin", Buffer.from([0x68, 0x65, 0x00, 0x6c]));
    assert.deepEqual(loadFile(file), { ok: false, reason: "binary" });
  });
});

test("loadFile: file over the default 1 MiB limit reports too-large", () => {
  withTempDir((dir) => {
    const file = write(dir, "big.txt", Buffer.alloc(MIB + 1, 0x61));
    assert.deepEqual(loadFile(file), { ok: false, reason: "too-large" });
  });
});

test("loadFile: file of exactly 1 MiB loads under the default limit", () => {
  withTempDir((dir) => {
    const file = write(dir, "ok.txt", Buffer.alloc(MIB, 0x61));
    const result = loadFile(file);
    assert.ok(result.ok);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].length, MIB);
  });
});

test("loadFile: custom maxBytes rejects one byte over and accepts the exact size", () => {
  withTempDir((dir) => {
    assert.deepEqual(loadFile(write(dir, "over.txt", "123456789"), 8), {
      ok: false,
      reason: "too-large",
    });
    const result = loadFile(write(dir, "exact.txt", "12345678"), 8);
    assert.ok(result.ok);
    assert.deepEqual(result.lines, ["12345678"]);
  });
});

test("extractRange: full-line range keeps lines and joins with newlines", () => {
  const lines = ["alpha", "beta", "gamma"];
  const range: Range = { startLine: 0, startCol: 0, endLine: 1, endCol: lines[1].length };
  assert.equal(extractRange(lines, range), "alpha\nbeta");
});

test("extractRange: single-line char range slices raw columns", () => {
  const lines = ["alpha", "beta", "gamma"];
  const range: Range = { startLine: 1, startCol: 1, endLine: 1, endCol: 3 };
  assert.equal(extractRange(lines, range), "et");
});

test("extractRange: multi-line range slices ends and keeps middle lines whole", () => {
  const lines = ["alpha", "beta", "gamma", "delta"];
  const range: Range = { startLine: 0, startCol: 2, endLine: 2, endCol: 3 };
  assert.equal(extractRange(lines, range), "pha\nbeta\ngam");
});

test("extractRange: newlines between selected lines are included", () => {
  const lines = ["alpha", "beta"];
  const range: Range = { startLine: 0, startCol: 0, endLine: 1, endCol: lines[1].length };
  const snapshot = extractRange(lines, range);
  assert.ok(snapshot.includes("\n"));
  assert.equal(snapshot, "alpha\nbeta");
});

test("extractRange: degenerate same-column range returns the empty string", () => {
  const lines = ["alpha"];
  const range: Range = { startLine: 0, startCol: 2, endLine: 0, endCol: 2 };
  assert.equal(extractRange(lines, range), "");
});
