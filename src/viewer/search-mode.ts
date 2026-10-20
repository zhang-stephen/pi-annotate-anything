// Search mode of the viewer state machine: incremental "/" jumps, n/N
// repeats of the last submitted pattern, and Enter submission. Driven by
// state.ts, which dispatches search-mode keys here.

import type { Position } from "../core/selection.ts";
import { compilePattern, findMatches, jumpTarget } from "../core/search.ts";
import { toCommentKey } from "./comment-mode.ts";
import { consumeCount, keepVisible, moved } from "./movement.ts";
import type { ViewerResult, ViewerState, ViewerViewport } from "./state.ts";

// n semantics shared by normal-mode n/N and the empty-query Enter replay:
// jump `count` matches of lastSearch from the cursor in `dir`. Inert without
// lastSearch; a compile failure surfaces the engine's message; an empty
// match set reports "Pattern not found"; otherwise move via moved() and set
// the vim wrap message for the direction (the caller cleared any incoming
// message, so an unwrapped jump leaves none).
export function repeatSearch(
  state: ViewerState,
  dir: 1 | -1,
  count: number,
  lines: string[],
  viewport: ViewerViewport,
): ViewerResult {
  const last = state.lastSearch ?? null;
  if (last === null) return { state };
  const compiled = compilePattern(last);
  if (!compiled.ok) return { state: { ...state, message: compiled.error } };
  const matches = findMatches(lines, compiled.re);
  if (matches.length === 0) return { state: { ...state, message: "Pattern not found: " + last } };
  const target = jumpTarget(matches, state.cursor, dir, count);
  if (target === null) return { state }; // unreachable: matches is non-empty
  const wrappedMessage =
    target.wrapped ? (dir === 1 ? "search hit BOTTOM, continuing at TOP" : "search hit TOP, continuing at BOTTOM") : null;
  const res = consumeCount(moved(state, target.pos, lines, viewport));
  return wrappedMessage === null ? res : { state: { ...res.state, message: wrappedMessage } };
}

// Incremental search jump after every query change: first match at or after
// the search origin in forward reading order (same line at/after the origin
// column, else any later line). Compile failures and empty match sets park
// the cursor back on the origin - the only position the user committed to -
// with the compile error surfaced as a message in the failure case.
export function incrementalJump(
  state: ViewerState,
  search: { query: string; origin: Position },
  lines: string[],
  viewport: ViewerViewport,
): ViewerResult {
  // An empty query matches everywhere (/ (?:) /g): skip the full-file scan
  // and just sit on the origin until real input arrives.
  if (search.query === "") {
    return { state: keepVisible({ ...state, cursor: search.origin, message: null }, lines, viewport) };
  }
  const compiled = compilePattern(search.query);
  if (!compiled.ok) {
    return { state: keepVisible({ ...state, cursor: search.origin, message: compiled.error }, lines, viewport) };
  }
  const matches = findMatches(lines, compiled.re);
  const atOrAfter = matches.find(
    (m) => m.line > search.origin.line || (m.line === search.origin.line && m.startCol >= search.origin.col),
  );
  if (atOrAfter === undefined) {
    return { state: keepVisible({ ...state, cursor: search.origin }, lines, viewport) };
  }
  return moved(state, { line: atOrAfter.line, col: atOrAfter.startCol }, lines, viewport);
}

// Enter in search mode: an invalid pattern keeps editing (the compile error
// is re-set as the message - reduceViewer cleared the incoming one); an
// empty query replays lastSearch forward like n from the cursor, or just
// exits to the origin cursor without one; otherwise the query becomes
// lastSearch, the incremental jump stands, and search mode closes.
export function submitSearch(
  state: ViewerState,
  search: { query: string; origin: Position },
  lines: string[],
  viewport: ViewerViewport,
): ViewerResult {
  if (search.query !== "") {
    const compiled = compilePattern(search.query);
    if (!compiled.ok) return { state: { ...state, message: compiled.error } };
    // A valid pattern with zero matches stores lastSearch (n repeats it and
    // fails again, like vim) but reports instead of jumping; the cursor
    // stays where the incremental scan left it (the origin).
    if (findMatches(lines, compiled.re).length === 0) {
      return { state: { ...state, mode: "normal", search: null, lastSearch: search.query, message: "Pattern not found: " + search.query } };
    }
    return { state: { ...state, mode: "normal", search: null, lastSearch: search.query } };
  }
  if ((state.lastSearch ?? null) === null) {
    return { state: keepVisible({ ...state, mode: "normal", search: null, cursor: search.origin }, lines, viewport) };
  }
  return repeatSearch({ ...state, mode: "normal", search: null }, 1, 1, lines, viewport);
}

// Search mode routes every key through toCommentKey's classification:
// chunks append whole (pastes included), backspace pops one code unit,
// Enter submits, Esc cancels, and newline-shaped keys are ignored (single-
// line input). Chunks with control characters and unmapped sequences are
// ignored, mirroring comment mode.
export function searchStep(state: ViewerState, key: string, lines: string[], viewport: ViewerViewport): ViewerResult {
  const mapped = toCommentKey(key);
  if (mapped === null) return { state };
  const search = state.search ?? { query: "", origin: state.cursor }; // invariant: non-null in search mode
  switch (mapped.kind) {
    case "newline":
      return { state };
    case "backspace": {
      const next = { ...search, query: search.query.slice(0, -1) };
      return incrementalJump({ ...state, search: next }, next, lines, viewport);
    }
    case "char": {
      const next = { ...search, query: search.query + mapped.ch };
      return incrementalJump({ ...state, search: next }, next, lines, viewport);
    }
    case "cancel":
      // Esc: back to normal on the origin cursor; lastSearch untouched.
      return { state: keepVisible({ ...state, mode: "normal", search: null, cursor: search.origin }, lines, viewport) };
    case "submit":
      return submitSearch(state, search, lines, viewport);
  }
}
