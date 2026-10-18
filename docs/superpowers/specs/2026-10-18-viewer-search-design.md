---
title: Viewer Search - Design
status: done
plan: ../plans/2026-10-19-viewer-search.md
---

# Viewer Search - Design

Date: 2026-10-18
Follow-up to: 2026-10-18-statusline-and-hscroll-design.md (lands the provisioned cmdline "input" variant)

## Problem

The annotation card has no way to locate content other than scrolling.
Annotating a large file means hunting line by line with `j`/`k`/`G`.
The card chrome already provisions for vim-style search: the cmdline row has an `input` variant whose cursor-cell rendering was explicitly deferred to this spec.

## Approach

Vim-style `/` search, with decisions from the design discussion:

1. **Regex, not literal**: patterns are JavaScript `RegExp` sources (no vim magic translation), with smartcase: a pattern containing no uppercase letter matches case-insensitively, any uppercase makes it case-sensitive.
2. **Incremental search**: every keystroke recomputes matches and jumps the cursor to the first match; Enter accepts, Esc cancels.
3. **hlsearch-style highlight**: all matches of the active pattern are highlighted in the viewport, in every mode, until the card closes.
4. **Count prefix**: normal mode gains a vim-style `{count}` prefix; `{count}n`/`{count}N` repeat the search, and the same machinery serves `j`/`k`/`h`/`l`/`G`.
5. **Normal mode only**: `/` enters search from normal mode only; `n`/`N` work in normal mode only, so returning from comment mode (which auto-returns to normal) keeps them available.
6. **Cmdline reuse**: the search input renders in the cmdline row; after Enter the hints return and the pattern plus match counter move to the statusline row.
7. **Transient messages**: wrap-around notices and invalid-pattern errors render as a right-aligned widget on the cmdline row, cleared on the next keypress.
8. **No manual clear**: clearing the search (`:nohlsearch` equivalent) is deferred to a future `:` command spec; Esc keeps its current meanings untouched.

## Search semantics (`src/search.ts`, new pure module)

No I/O, no pi imports beyond types; unit-testable like `viewer-state.ts`.

```ts
export interface LineMatch { line: number; startCol: number; endCol: number }  // raw columns, endCol exclusive
export type CompiledPattern = { ok: true; re: RegExp } | { ok: false; error: string };

export function compilePattern(pattern: string): CompiledPattern;
export function findMatches(lines: string[], re: RegExp): LineMatch[];
export function jumpTarget(matches: LineMatch[], from: Position, dir: 1 | -1, count: number):
  { pos: Position; wrapped: boolean } | null;
```

- `compilePattern` builds the `RegExp` with flags `"g"` plus `"i"` when the pattern contains no uppercase ASCII letter (smartcase).
  A pattern that fails to compile returns `{ ok: false, error }` with the engine's message; nothing throws.
- `findMatches` scans each line independently; there are no cross-line matches.
  `re.lastIndex` is reset per line, and zero-width matches (e.g. `a*`) advance the scan by one code unit so they cannot loop forever.
- Matching happens on raw line text in raw columns; display-column mapping happens only at render time via the existing `displaySpan`/`rawColToDisplayCol` path, so tabs and CJK stay correct.
- `jumpTarget` finds the `count`-th match strictly after (`dir: 1`) or strictly before (`dir: -1`) `from`, wrapping around the file and reporting `wrapped`; it returns `null` when `matches` is empty.

## State machine (`src/viewer-state.ts`)

```ts
export type ViewerMode = "normal" | "visual-char" | "visual-line" | "comment" | "search";

interface ViewerState {
  // ... existing fields ...
  search: { query: string; origin: Position } | null;  // active while mode === "search"
  lastSearch: string | null;                           // last submitted pattern source
  count: number | null;                                // pending {count} prefix, normal mode only
  message: string | null;                              // transient cmdline message, cleared on next key
}
```

Search mode:

- `/` in normal mode enters search mode with `search = { query: "", origin: cursor }` and resets `count`.
- Keys in search mode are handled by a small `reduceSearch` (single-line; printable text appends, backspace pops, Enter submits, Esc cancels).
  Printable-text classification reuses the same bytes-as-text convention as the comment input, so IME/CJK input works the same way.
- After every query change the reducer recompiles and rescans:
  - valid pattern with a match: the cursor jumps (incremental, forward from `origin`, no wrap) to the match start via the existing `moved()`/`keepVisible()` path, so vertical and horizontal scroll follow for free;
  - valid pattern with no match: the cursor stays at `origin`;
  - invalid pattern: `message` is set to the compile error, the cursor stays at `origin`.
- Enter: an invalid pattern keeps search mode open (vim errors the same way).
  An empty query re-uses `lastSearch` if one exists (vim's repeat-last semantics), jumping forward from the cursor like `n`; with no `lastSearch` it just exits.
  Otherwise `lastSearch = query`, search mode exits to normal, and the cursor stays where the incremental jump left it.
- Esc exits to normal, restores the cursor to `origin` (through `keepVisible`), and leaves any previous `lastSearch` intact.

Repeat and count, normal mode only:

- `n`/`N` jump to the next/previous match of `lastSearch` from the cursor (via `jumpTarget`); `wrapped` sets `message` to `search hit BOTTOM, continuing at TOP` or `search hit TOP, continuing at BOTTOM` (vim wording).
  With no matches at all, `message` becomes `Pattern not found: <pattern>` (vim's E486) and the cursor does not move.
  Without a `lastSearch`, `n`/`N` are inert.
- Count prefix: digits `1`-`9` start `count`, `0`-`9` extend it; a bare `0` with no pending count remains the column-0 motion, exactly like vim.
  `count` is consumed and cleared by `n`/`N`, `j`/`k`, `h`/`l`, and `G` (`{count}G` goes to line `count`, clamped); any other key clears it without effect.
  The pending count is not displayed anywhere (vim default shows nothing either).
- Any keypress clears `message` after applying its own effect (so a message survives exactly one render).

## Match highlighting (`src/viewer.ts`)

- `SpanStyle` gains `"match"`, ~~rendered with a distinct accent-backed style in `spanStyles`~~ amended after user E2E (2026-10-19): accent fg + bold proved too subtle; matches follow pi's two-level searchMatch convention - `"match"` paints `searchMatchBg` over `searchMatchText`, and `"matchCurrent"` (the match containing the cursor) ~~swaps the pair plus bold~~ amended in code review (2026-10-19): literal token swapping throws `Unknown theme color` at runtime - pi's Theme strictly partitions fg/bg token roles - so `matchCurrent` mirrors pi's own `searchCurrentMatchStyle` exactly: `bold(inverse(bg("searchMatchBg", fg("searchMatchText", s))))`, i.e. bold + SGR inverse over the same pair.
- Amended after user E2E (2026-10-19): zero matches hide the statusline segment entirely (no `[0/0]`), and submitting a zero-match pattern stores `lastSearch` and surfaces `Pattern not found: <pattern>` as the transient cmdline message, cleared by the next keypress.
  The existing nesting/composition rules are unchanged: `match` composes with `underline`/`dimUnderline`/`target` (different attributes), and `inverse` (selection, cursor cell) still wins over everything.
- The highlighted pattern is the in-progress `search.query` while in search mode (incremental feedback) and `lastSearch` otherwise; visual and comment modes keep the highlight, matching vim's `hlsearch`.
- Matches are recomputed once per render from the active pattern over all loaded lines (the 1MB file cap makes this cheap), then mapped to display-column spans per line through the existing `displaySpan` mechanism, before `sliceWindow` cuts the viewport window. Amended in code review (2026-10-19): mapping is viewport-only and incremental - spans are built only for rows `[first, last)`, zero-width matches are skipped, and each line's sorted match columns map in one left-to-right walk (`rawColsToDisplayCols`), so a frame costs O(file) for the scan plus O(viewport) for mapping; the original per-match `rawColToDisplayCol` calls were O(matches x line length) and froze on minified long-line files.
- ~~There is no distinct current-match style (vim's `CurSearch`); the inverse cursor cell already marks the current match.~~ Amended after user E2E (2026-10-19): superseded by the two-level convention above - the cursor's match gets `matchCurrent`.

## Bottom area (`src/status-line.ts`)

`CardMode` gains `"search"` with badge `-- SEARCH --`; its `FOOTER_HINTS` entry exists only for badge/type completeness because the cmdline shows the input row in search mode.

Statusline row:

- `StatusLineInput` gains `search?: { pattern: string; rank: number; total: number } | null`, where `rank` is the 1-based rank of the match the cursor sits on (`0` when the cursor is on no match) and `total` is the match count.
- Normal mode with an active search shows `/pattern [rank/total]` (dim) between the badge and the cursor position.
  Search mode shows only `[rank/total]` (the pattern is already visible in the cmdline input).
  Visual and comment modes hide the segment entirely.
- Truncation order under narrow widths: the search segment is dropped first, then the visual selection range; badge and cursor position are always preserved.
  A too-long pattern is not partially rendered; the segment drops as a whole (the cmdline input and the highlight still carry the information).

Cmdline row:

- The `input` variant gets its final rendering: the prompt (`/`) in accent, the typed value in default text, and an emulated cursor cell (one inverse space) at the end, since editing is append-only like the comment box.
  When the value overflows the width, it is windowed tail-biased so the cursor cell stays visible; the prompt never scrolls away.
- The `hints` variant gains `message?: string | null`, rendered right-aligned in accent; on width contention the hints truncate first and the message is preserved.
- `FOOTER_HINTS.normal.hints` gains the search keys: `hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  q/Esc close` (final wording may be shortened to fit).

## Testing

- `test/search.test.ts` (new): smartcase flag selection, invalid patterns never throw, per-line matching with `lastIndex` reset, zero-width match advancement, `jumpTarget` forward/backward with counts and wrap flags, raw-column correctness on tabbed and CJK lines.
- `test/viewer-state.test.ts` (extend): `/` entry and Esc restore, incremental jump per keystroke, invalid pattern keeps search mode and sets the message, Enter submit/repeat-last/empty-query branches, `n`/`N` wrap messages, `{count}n` and `{count}j`/`{count}G` consumption, bare `0` still column-0, count cleared by unrelated keys, message cleared on next key.
- `test/status-line.test.ts` (extend): search segment shown in normal mode, count-only in search mode, hidden in visual/comment modes, truncation order (search first, then selection range), cmdline `input` cursor cell and tail-biased windowing, right-aligned `message` with hints truncation.
- `test/viewer.test.ts` (extend): match spans mapped through tab expansion and CJK, highlight composes with pending underlines and loses to inverse selection, highlight persists in comment mode.

## Chrome inner padding (ride-along, unrelated to search)

Problem: the panel's vertical borders sit flush against the content, so the gutter and text touch the border glyphs and the card reads cramped; the floating comment box has the same issue.

Decision: add a fixed 1-column blank padding inside the left and right borders of every framed row, applied in one place.

- `src/card-chrome.ts` `innerRow` renders border + 1 space + content + fill + 1 space + border; the padding width is a named constant (e.g. `PAD_X = 1`), not sprinkled as literals.
- The content budget shrinks by 2 columns card-wide: `src/viewer.ts` derives its inner width as card width minus borders minus `2 * PAD_X` before subtracting the gutter, and `frameCommentBox` truncates to width minus borders minus `2 * PAD_X`.
- Every display-column coordinate that assumed the content origin sits directly inside the left border shifts by `PAD_X`: the comment-box splice offset in `src/viewer.ts` (`spliceRow` calls) and the `commentBoxPlacement` clamp base move right by one column.
- Width invariants are unchanged: every rendered row keeps exact display width, and existing behaviors (hscroll clamp, windowing, truncation) operate on the shrunken content width with no logic changes.
- Testing: `test/card-chrome.test.ts` and the exact-row assertions in `test/viewer.test.ts` are updated to the padded rendering; a new card-chrome test pins the invariant that no content cell ever touches a border column at any card width, including the narrowest supported width.

## Explicitly out of scope

- Clearing the search (`:nohlsearch` equivalent) and `:` commands in general: future spec; the cmdline `input` variant already accommodates them.
- Cross-line matches, vim magic/very-magic modes, `\c`/`\C` case overrides, per-pattern case flags.
- Search from visual mode (vim's selection-extending `/`), search history (`/` + arrow up), distinct current-match styling.
- Count prefixes in visual modes and for `ctrl+d`/`ctrl+u`/PgUp/PgDn; `{count}gg`.
- Persisting `lastSearch` across card openings.
