// Pure payload and label formatting for annotations. All displayed
// numbers are 1-based; internal positions are 0-based (see selection.ts).
// Formats are contract-fixed: the token label is rendered in the composer
// pill (editor.ts) and the payload is injected into the conversation
// (transform.ts), so the exact strings here are part of the MVP contract.

import path from "node:path";

import type { Range, VisualMode } from "./selection.ts";

// Markdown fence language tags keyed by file extension. Unlisted
// extensions fall back to "" (a bare ``` fence, i.e. plain text).
const EXT_LANGUAGE: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  py: "python",
  rs: "rust",
  go: "go",
  json: "json",
  md: "markdown",
  sh: "sh",
  yaml: "yaml",
  toml: "toml",
  css: "css",
  html: "html",
};

function languageFromPath(absPath: string): string {
  const dot = absPath.lastIndexOf(".");
  if (dot < 0 || dot === absPath.length - 1) return "";
  return EXT_LANGUAGE[absPath.slice(dot + 1)] ?? "";
}

function isSingleLine(range: Range): boolean {
  return range.startLine === range.endLine;
}

// "lines 10-20" | "lines 10" | "lines 10:5-12:20" | "lines 10:5-10:12".
// Char-wise never collapses: column precision is the point of the mode.
export function rangeLabel(range: Range, mode: VisualMode): string {
  const s = range.startLine + 1;
  const e = range.endLine + 1;
  if (mode === "line") {
    return isSingleLine(range) ? `lines ${s}` : `lines ${s}-${e}`;
  }
  const sc = range.startCol + 1;
  const ec = range.endCol + 1;
  return `lines ${s}:${sc}-${e}:${ec}`;
}

// Relative to cwd when the file lies inside cwd, otherwise absolute.
// path.relative never yields a leading "./" for a strict descendant.
export function displayPath(absPath: string, cwd: string): string {
  const rel = path.relative(cwd, absPath);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return absPath;
  }
  return rel;
}

// Compact form without the "lines" word: "[src/a.ts:10-20]",
// "[src/a.ts:10]", "[src/a.ts:10:5-12:20]", "[src/a.ts:10:5-10:12]".
export function tokenLabel(absPath: string, cwd: string, range: Range, mode: VisualMode): string {
  const p = displayPath(absPath, cwd);
  const s = range.startLine + 1;
  const e = range.endLine + 1;
  if (mode === "char") {
    return `[${p}:${s}:${range.startCol + 1}-${e}:${range.endCol + 1}]`;
  }
  return isSingleLine(range) ? `[${p}:${s}]` : `[${p}:${s}-${e}]`;
}

export function formatPayload(input: {
  absPath: string;
  cwd: string;
  range: Range;
  mode: VisualMode;
  snapshot: string;
  comment: string;
}): string {
  const header = `In \`${displayPath(input.absPath, input.cwd)}\` (${rangeLabel(input.range, input.mode)}):`;
  const fence = "```" + languageFromPath(input.absPath);
  // Snapshots conventionally end with "\n"; strip exactly one so the
  // closing fence sits directly after the last content line.
  const body = input.snapshot.endsWith("\n") ? input.snapshot.slice(0, -1) : input.snapshot;
  const lines = [header, fence, body, "```"];
  if (input.comment !== "") lines.push(`Comment: ${input.comment}`);
  return lines.join("\n");
}
