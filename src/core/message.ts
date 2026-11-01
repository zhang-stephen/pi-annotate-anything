// Pure payload and label formatting for annotations. All displayed
// numbers are 1-based; internal positions are 0-based (see selection.ts).
// Two string contracts live here. The token label is the composer pill's
// display text: editor.ts recoloring and transform.ts's alt+o lookup match
// it by exact substring, and store.ts appends its "~N" collision suffixes,
// so any label restyle must keep every generated label exact-match stable.
// The payload is the block injected into the conversation (transform.ts);
// its layout stays stable because the model reads and quotes it back.

import path from "node:path";

import type { Range, VisualMode } from "./selection.ts";

// The Nerd Font annotation glyph shared by composer pills (tokenLabel) and
// the viewer's pending gutter marker (viewer.ts PENDING_ICON alias).
export const ANNOTATION_ICON = "\u{F075}"; // nf-fa-comment

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

// "lines 10-20" | "lines 10" | "lines 10:5-12:19" | "lines 10:5-10:11".
// Char-wise never collapses: column precision is the point of the mode.
// Both char columns print 1-based inclusive: endCol already equals the
// 1-based column of the last selected char (it is the 0-based exclusive
// slice bound, one past the cursor char), so only the start column gets +1.
export function rangeLabel(range: Range, mode: VisualMode): string {
  const s = range.startLine + 1;
  const e = range.endLine + 1;
  if (mode === "line") {
    return isSingleLine(range) ? `lines ${s}` : `lines ${s}-${e}`;
  }
  const sc = range.startCol + 1;
  const ec = range.endCol;
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

// Compact pill label: "[<icon> <basename><range>]", e.g. "[<icon> a.ts:10-20]".
// The basename alone keeps pills short and cwd-independent; identical
// basenames from different directories produce identical labels, which
// store.ts disambiguates with its "~N" suffix.
export function tokenLabel(absPath: string, range: Range, mode: VisualMode): string {
  const base = path.basename(absPath);
  const s = range.startLine + 1;
  const e = range.endLine + 1;
  if (mode === "char") {
    // endCol prints as-is: 0-based exclusive slice bound == 1-based inclusive
    // column of the last selected char.
    return `[${ANNOTATION_ICON} ${base}:${s}:${range.startCol + 1}-${e}:${range.endCol}]`;
  }
  return isSingleLine(range)
    ? `[${ANNOTATION_ICON} ${base}:${s}]`
    : `[${ANNOTATION_ICON} ${base}:${s}-${e}]`;
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
