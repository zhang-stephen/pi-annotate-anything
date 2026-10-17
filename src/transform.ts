// Input transform: expands annotation tokens in a submitted message into
// their full payload blocks (formatPayload). Lookup is exact-match against
// live store tokens, so token-like text that matches no draft passes
// through untouched. Each expansion is blank-line separated from the
// surrounding prose; whitespace trailing the prose before a token is
// trimmed so the payload sits flush after the last word.

import { formatPayload } from "./message.ts";
import type { AnnotationStore } from "./store.ts";

export interface ExpandResult {
  changed: boolean;
  text: string;
}

export function expandTokens(text: string, store: AnnotationStore, cwd: string): ExpandResult {
  const drafts = store.list();
  if (drafts.length === 0) return { changed: false, text };

  const byToken = new Map(drafts.map((d) => [d.token, d]));
  // Tokens contain regex metacharacters ("[", "."), so escape before
  // building the alternation pattern. Longest-first ordering (mirrors
  // recolorTokens in editor.ts) keeps a token that is a prefix of a longer
  // token from shadowing it.
  const pattern = new RegExp(
    [...byToken.keys()]
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()[\]\\|]/g, "\\$&"))
      .join("|"),
    "g",
  );
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return { changed: false, text };

  let out = "";
  let cursor = 0;
  let changed = false;
  for (const match of matches) {
    const draft = byToken.get(match[0]);
    const start = match.index;
    if (!draft || start === undefined) continue;
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
    cursor = start + match[0].length;
    changed = true;
  }
  out += text.slice(cursor);
  return { changed, text: out };
}
