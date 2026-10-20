// Pure search primitives shared by the viewer's search mode and highlight
// wiring. No I/O and no UI: pattern compilation, per-line scanning, and
// wrap-around jump targets only.
import type { Position } from "./selection.ts";

// A match inside one line. Columns are raw code-unit offsets into the line
// (end-exclusive), so they line up with Range.startCol/endCol slices.
export interface LineMatch { line: number; startCol: number; endCol: number }
export type CompiledPattern = { ok: true; re: RegExp } | { ok: false; error: string };

// Compiles a search pattern with smartcase flags: "g" always, plus "i"
// only when the pattern contains no uppercase ASCII letter. An invalid
// pattern yields the engine's message instead of throwing, so callers can
// render it as feedback.
export function compilePattern(pattern: string): CompiledPattern {
  const smartcase = /[A-Z]/.test(pattern) ? "" : "i";
  try {
    return { ok: true, re: new RegExp(pattern, "g" + smartcase) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Scans each line independently for all matches of `re`. A non-global regex
// is upgraded to global internally (the caller's regex is left untouched);
// `lastIndex` is reset per line; a zero-width match advances lastIndex by one
// code unit so the scan terminates. Returned columns are raw code-unit offsets.
export function findMatches(lines: string[], re: RegExp): LineMatch[] {
  const matches: LineMatch[] = [];
  const global = re.global ? re : new RegExp(re.source, re.flags + "g");
  for (let line = 0; line < lines.length; line++) {
    global.lastIndex = 0;
    const text = lines[line];
    while (global.lastIndex <= text.length) {
      const m = global.exec(text);
      if (m === null) break;
      matches.push({ line, startCol: m.index, endCol: m.index + m[0].length });
      if (m[0].length === 0) global.lastIndex++;
    }
  }
  return matches;
}

// Returns the position `count` matches away from `from` in direction `dir`,
// or null when there are no matches at all. A match counts as reachable
// only when it lies strictly after (dir 1) or strictly before (dir -1)
// `from`; once the strict candidates run out the scan wraps around the
// whole match list and reports wrapped. Zero-width matches are jumpable.
// `count < 1` is treated as 1.
export function jumpTarget(
  matches: LineMatch[],
  from: Position,
  dir: 1 | -1,
  count: number,
): { pos: Position; wrapped: boolean } | null {
  if (matches.length === 0) return null;
  const n = count < 1 ? 1 : count;
  const ordered = dir === 1 ? matches : [...matches].reverse();
  const isBeyond = (m: LineMatch): boolean =>
    dir === 1
      ? m.line > from.line || (m.line === from.line && m.startCol > from.col)
      : m.line < from.line || (m.line === from.line && m.startCol < from.col);
  let firstBeyond = 0;
  while (firstBeyond < ordered.length && !isBeyond(ordered[firstBeyond])) firstBeyond++;
  const candidates = ordered.length - firstBeyond;
  const index = n <= candidates
    ? firstBeyond + n - 1
    : (n - candidates - 1) % ordered.length;
  const match = ordered[index];
  return { pos: { line: match.line, col: match.startCol }, wrapped: n > candidates };
}
