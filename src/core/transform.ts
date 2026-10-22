// Input transform: expands annotation tokens in a submitted message into
// their full payload blocks (formatPayload). Lookup is exact-match against
// live store tokens, so token-like text that matches no draft passes
// through untouched. Each expansion is blank-line separated from the
// surrounding prose; whitespace trailing the prose before a token is
// trimmed so the payload sits flush after the last word.
//
// The same token-in-text matcher (findTokenMatches) also serves the
// composer's alt+o jump-back: the buffer is scanned for live tokens and the
// LAST occurrence selects the jump target.

import { formatPayload } from "./message.ts";
import type { AnnotationStore } from "./store.ts";

export interface ExpandResult {
  changed: boolean;
  text: string;
}

// One occurrence of a token in scanned text.
export interface TokenMatch {
  token: string;
  // Index of the match's first character in the scanned text.
  index: number;
}

// Locates every occurrence of every listed token in text, left to right.
// Tokens contain regex metacharacters ("[", "."), so they are escaped
// before building the alternation pattern. Longest-first ordering (mirrors
// recolorTokens in editor.ts) keeps a token that is a prefix of a longer
// token from shadowing it. Zero-length tokens are skipped (an empty
// alternation branch would match everywhere).
export function findTokenMatches(text: string, tokens: string[]): TokenMatch[] {
  const present = tokens.filter((t) => t.length > 0);
  if (present.length === 0) return [];
  const pattern = new RegExp(
    present
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()[\]\\|]/g, "\\$&"))
      .join("|"),
    "g",
  );
  return [...text.matchAll(pattern)].map((m) => ({ token: m[0], index: m.index ?? 0 }));
}

// The LAST (rightmost) token occurrence in text, or null when no token
// occurs. Rightmost means most recently attached: the composer jump-back
// lands on the newest pill still present in the buffer.
export function lastTokenIn(text: string, tokens: string[]): TokenMatch | null {
  const matches = findTokenMatches(text, tokens);
  return matches.length === 0 ? null : matches[matches.length - 1]!;
}

export function expandTokens(text: string, store: AnnotationStore, cwd: string): ExpandResult {
  const drafts = store.list();
  if (drafts.length === 0) return { changed: false, text };

  const byToken = new Map(drafts.map((d) => [d.token, d]));
  const matches = findTokenMatches(text, [...byToken.keys()]);
  if (matches.length === 0) return { changed: false, text };

  let out = "";
  let cursor = 0;
  let changed = false;
  for (const match of matches) {
    const draft = byToken.get(match.token);
    const start = match.index;
    if (!draft) continue;
    out += text.slice(cursor, start).trimEnd();
    const payload = formatPayload({
      absPath: draft.absPath,
      cwd,
      range: draft.range,
      mode: draft.mode,
      snapshot: draft.snapshot,
      comment: draft.comment,
    });
    out += `\n\n${payload}\n\n`;
    cursor = start + match.token.length;
    changed = true;
  }
  out += text.slice(cursor);
  return { changed, text: out };
}
