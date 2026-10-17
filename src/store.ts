// In-memory draft store for annotations prepared for injection. Tokens are
// map keys, so lookups are exact-match only. Insertion order of list() comes
// from Map iteration order. Suffix numbering must never collide among live
// drafts, even after prune leaves gaps in the numbering.

import type { Range, VisualMode } from "./selection.ts";

export interface Draft {
  token: string; // "[a.ts:10-20]" or "[a.ts:10-20 ~2]"
  absPath: string;
  range: Range;
  mode: VisualMode;
  snapshot: string;
  comment: string;
}

const FIRST_SUFFIX = 2;
const SUFFIX_PATTERN = /^(.*) ~(\d+)\]$/;

// Strips a trailing " ~N" disambiguation suffix: "[a.ts:10-20 ~2]" ->
// "[a.ts:10-20]"; tokens without a suffix pass through unchanged.
function baseOf(token: string): string {
  const m = SUFFIX_PATTERN.exec(token);
  return m ? m[1] + "]" : token;
}

export class AnnotationStore {
  private drafts = new Map<string, Draft>();

  // Adds a draft under baseToken, or the next free "~N" variant of it when
  // the base (or a prior variant) is already taken by a live draft.
  add(draft: Omit<Draft, "token">, baseToken: string): Draft {
    const base = baseOf(baseToken);
    let token = base;
    for (let n = FIRST_SUFFIX; this.drafts.has(token); n++) {
      token = `${base.slice(0, -1)} ~${n}]`;
    }
    const stored: Draft = { ...draft, token };
    this.drafts.set(token, stored);
    return stored;
  }

  get(token: string): Draft | undefined {
    return this.drafts.get(token);
  }

  list(): Draft[] {
    return [...this.drafts.values()];
  }

  // Keeps only drafts whose token is listed in presentTokens.
  prune(presentTokens: string[]): void {
    const present = new Set(presentTokens);
    for (const token of this.drafts.keys()) {
      if (!present.has(token)) this.drafts.delete(token);
    }
  }

  // Keeps only drafts whose token occurs as a substring of text (a rendered
  // prompt, say): a token absent from the text was not quoted back to us.
  pruneFromText(text: string): void {
    for (const [token] of this.drafts) {
      if (!text.includes(token)) this.drafts.delete(token);
    }
  }

  clear(): void {
    this.drafts.clear();
  }
}
