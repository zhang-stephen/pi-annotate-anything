// Enforces the one-way layering declared in src/AGENTS.md: core <- tui <- viewer <- index.ts.
// The scanner walks src/**/*.ts, extracts every `from "<specifier>"` import, resolves
// relative specifiers against the importing file, and fails on upward or sideways edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const files = walk(SRC_ROOT);

function filesIn(layer: string): string[] {
  return files.filter((f) => dirname(relative(SRC_ROOT, f)) === layer);
}

function inLayer(resolved: string, layer: string): boolean {
  return resolved.startsWith(join(SRC_ROOT, layer) + sep);
}

// Every `from "<specifier>"` in a file, with relative specifiers resolved to absolute paths.
function importsOf(file: string): { specifier: string; resolved: string | null }[] {
  const text = readFileSync(file, "utf8");
  const out: { specifier: string; resolved: string | null }[] = [];
  for (const m of text.matchAll(/from "([^"]+)"/g)) {
    const specifier = m[1];
    out.push({ specifier, resolved: specifier.startsWith(".") ? resolve(dirname(file), specifier) : null });
  }
  return out;
}

test("src/core imports nothing outside src/core except node:* builtins", () => {
  const violations: string[] = [];
  for (const file of filesIn("core")) {
    for (const { specifier, resolved } of importsOf(file)) {
      if (specifier.startsWith("node:")) continue;
      if (resolved !== null && inLayer(resolved, "core")) continue;
      violations.push(`${relative(SRC_ROOT, file)}: imports "${specifier}" outside src/core/`);
    }
  }
  assert.deepEqual(violations, []);
});

test("src/tui relative imports resolve only into src/tui/ or src/core/", () => {
  const violations: string[] = [];
  for (const file of filesIn("tui")) {
    for (const { specifier, resolved } of importsOf(file)) {
      if (resolved === null) continue; // host packages (@earendil-works/*) are allowed in tui
      if (inLayer(resolved, "tui") || inLayer(resolved, "core")) continue;
      violations.push(`${relative(SRC_ROOT, file)}: relative import "${specifier}" leaves tui/core`);
    }
  }
  assert.deepEqual(violations, []);
});

test("src/viewer relative imports resolve only into src/viewer/, src/tui/, or src/core/", () => {
  const violations: string[] = [];
  for (const file of filesIn("viewer")) {
    for (const { specifier, resolved } of importsOf(file)) {
      if (resolved === null) continue; // host packages are allowed in viewer
      if (inLayer(resolved, "viewer") || inLayer(resolved, "tui") || inLayer(resolved, "core")) continue;
      violations.push(`${relative(SRC_ROOT, file)}: relative import "${specifier}" leaves viewer/tui/core`);
    }
  }
  assert.deepEqual(violations, []);
});

test("the scan covers the full src module map (guards against a vacuous walk)", () => {
  const walked = new Set(files.map((f) => relative(SRC_ROOT, f)));
  const moved = [
    "core/selection.ts",
    "core/file-range.ts",
    "core/file-index.ts",
    "core/search.ts",
    "core/store.ts",
    "core/message.ts",
    "core/transform.ts",
    "tui/card-chrome.ts",
    "tui/display.ts",
    "tui/comment-input.ts",
    "tui/editor.ts",
    "tui/path-completion.ts",
    "viewer/viewer.ts",
    "viewer/state.ts",
    "viewer/movement.ts",
    "viewer/search-mode.ts",
    "viewer/comment-mode.ts",
    "viewer/layout.ts",
    "viewer/line-style.ts",
    "viewer/status-line.ts",
  ];
  const missing = moved.filter((m) => !walked.has(m));
  assert.deepEqual(missing, []);
});
