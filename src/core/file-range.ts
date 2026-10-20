// File loading with guards plus raw-column range extraction.
// loadFile reads only regular text files within a size cap, normalizes
// CRLF/CR to LF, and never produces a trailing empty line. extractRange
// slices raw code units: single-line ranges slice startCol..endCol,
// multi-line ranges keep middle lines whole and join with "\n".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Range } from "./selection.ts";

export type LoadResult =
  | { ok: true; path: string; lines: string[] }
  | { ok: false; reason: "not-found" | "is-directory" | "binary" | "too-large" | "read-error" };

export const DEFAULT_MAX_BYTES = 1024 * 1024;

// "~" expands to the home directory; everything else resolves against cwd.
export function resolvePath(input: string, cwd: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return path.resolve(cwd, input);
}

export function loadFile(path: string, maxBytes: number = DEFAULT_MAX_BYTES): LoadResult {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (stat.isDirectory()) return { ok: false, reason: "is-directory" };
  if (stat.size > maxBytes) return { ok: false, reason: "too-large" };

  let content: Buffer;
  try {
    content = fs.readFileSync(path);
  } catch {
    return { ok: false, reason: "read-error" };
  }
  // NUL byte is the cheap binary heuristic; text files never contain one.
  if (content.includes(0)) return { ok: false, reason: "binary" };

  const text = content.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = text === "" ? [] : text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { ok: true, path, lines };
}

// Slices raw columns per line; endCol is end-exclusive. Newlines between
// selected lines are included; no trailing newline is added.
export function extractRange(lines: string[], range: Range): string {
  const parts: string[] = [];
  for (let line = range.startLine; line <= range.endLine; line++) {
    const text = lines[line] ?? "";
    if (line === range.startLine && line === range.endLine) {
      parts.push(text.slice(range.startCol, range.endCol));
    } else if (line === range.startLine) {
      parts.push(text.slice(range.startCol));
    } else if (line === range.endLine) {
      parts.push(text.slice(0, range.endCol));
    } else {
      parts.push(text);
    }
  }
  return parts.join("\n");
}
