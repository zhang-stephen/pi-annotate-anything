---
status: approved
---

# Status Line and Horizontal Scroll - Design

Date: 2026-10-18
Follow-up to: 2026-10-17-annotate-card-chrome-design.md (replaces its static FOOTER_HINTS footer)
Prepares for: upcoming `/` search spec (separate document)

## Problem

The card footer is a static per-mode table (`FOOTER_HINTS` in `src/card-chrome.ts`) assembled inline in `AnnotateCard.render()` (`src/viewer.ts`): badge plus hints, nothing dynamic. Three problems:

1. There is no home for live information such as the cursor position, which becomes essential once lines can extend beyond the visible width.
2. Long lines are hard-truncated with `...` (`truncateToWidth` in `render()`), with no horizontal scrolling: the state machine only tracks `scrollTop`, so `h`/`l`/`$` can push `cursor.col` past the right edge and the inverse cursor cell gets clipped away - the cursor vanishes.
3. Holding an arrow key registers a single move; holding `h`/`j`/`k`/`l` repeats correctly. Root cause is confirmed: pi-tui enables kitty keyboard flags 7 (disambiguate + report event types + alternate keys), so functional keys emit distinct event sequences - arrow press arrives as the plain legacy `\x1b[A`, but the repeat arrives as `\x1b[1;1:2A` (event type 2). The TUI filters only release events (`tui.js`: `isKeyRelease && !wantsKeyRelease`) and passes repeats through to `handleInput`, where `reduceViewer` matches raw strings (`case "\x1b[A"`) and silently drops the repeat form. Text keys are unaffected because their repeats arrive as plain text bytes.

## Approach

Three coordinated changes in one spec, because displaying a meaningful cursor column requires horizontal scroll to exist, and the repeat fix lives in the same input path:

1. Replace the static footer with a two-row bottom area owned by a new pure-rendering module `src/status-line.ts`: a statusline row (mode badge, cursor position) above a cmdline row (key hints now; `/` search input and future `:` commands later, vim-style).
2. Add horizontal scrolling to the content area: `scrollLeft` in `ViewerState`, cursor-follow logic in the reducer, gutter fixed, content window sliced by display column.
3. Normalize kitty key-repeat sequences to their press equivalents in `AnnotateCard.handleInput` before dispatching to `reduceViewer`.

## Component layout

- New module `src/status-line.ts`, pure functions, no I/O:
  - `renderStatusLine(input: StatusLineInput, innerWidth: number, colors: ChromeColors): string`
  - `renderCommandLine(input: CommandLineInput, innerWidth: number, colors: ChromeColors): string`
- `FOOTER_HINTS` and `cardModeOf` move from `src/card-chrome.ts` into `src/status-line.ts`; `card-chrome.ts` keeps only generic framing (`framePanel`, `frameCommentBox`, placement).
- `framePanel(rows, width, opts)`: `opts.footer?: string` becomes `opts.footers?: string[]`, rendered in order directly below the content rows (statusline first, cmdline second). Everything else about the frame is unchanged.
- `CHROME_ROWS` in `src/viewer.ts` goes from 3 to 4 (viewport shrinks by one row; `MIN_VIEWPORT_ROWS` clamp unchanged).
- `AnnotateCard.render()` stops concatenating footer strings itself and delegates both rows to the two renderers.

## Statusline row

Layout inside the panel's inner width:

```
-- NORMAL --                                                          12:4
-- VISUAL --  8:1-12:4                                                12:4
```

- Left: mode badge (accent color), same four texts as today (`-- NORMAL --`, `-- VISUAL --`, `-- VISUAL LINE --`, `-- COMMENT --`).
- Right: cursor position `L:C`, 1-based; `C` is the display column after tab expansion (`rawColToDisplayCol(cursor.col) + 1`), matching the column semantics of `h`/`l`/`0`/`$`. Never truncated.
- Visual modes only: the selection range between badge and right margin, normalized so the smaller position comes first - `L:C-L:C` for visual-char (e.g. `8:1-12:4`, same-line `8:1-8:4`), `L-L` for visual-line (columns are always full width there).
- Truncation order under narrow widths: selection range first, then... nothing else; badge and position are always preserved (worst case the row degenerates to badge + position with no gap).

Explicitly not shown (user decision): pending draft count (stays in the title), scroll percentage or any scroll indicator.

## Cmdline row

Input is a discriminated union so future input modes plug in without touching chrome:

```ts
type CommandLineInput =
  | { kind: "hints"; mode: CardMode }
  | { kind: "input"; prompt: string; value: string; cursorCol: number };
```

- v1 renders only the `hints` variant: the per-mode hint text (dim color), i.e. exactly today's strings, truncated from the right when narrow.
- The `input` variant (prompt + value + emulated cursor cell) is defined now so the `/` search spec and future `:` commands render here with zero chrome changes; its concrete rendering lands with the search spec.
- Dynamic/contextual hint filtering (e.g. showing `Tab cycle  c edit  x delete` when the cursor sits on a draft) is a later refinement, not this spec.

## Key-repeat normalization

A small pure function `normalizeKeyRepeat(data: string): string` in `src/viewer.ts` (unit-tested in `test/viewer.test.ts`), applied at the top of `AnnotateCard.handleInput`:

- Kitty sequences with event type 2 (repeat) are rewritten to the equivalent press sequence: the `:<event>` field is removed, and when the modifier field is 1 (no modifier) it is removed too, collapsing to the legacy forms the reducer already matches: `\x1b[1;1:2A` -> `\x1b[A`, `\x1b[5;1:2~` -> `\x1b[5~`, `\x1b[<cp>;1:2u` -> `\x1b[<cp>u`.
- Sequences with a real modifier (modifier field > 1) keep the modifier, only the event field is stripped.
- Anything that is not a kitty repeat sequence passes through unchanged (press, release already filtered upstream, plain text).

This deliberately keeps the reducer's raw-string matching untouched. Migrating the reducer to logical-key matching via pi-tui's `matchesKey` (which already parses event types) is a possible later refactor, not this spec.

## Horizontal scrolling

State machine (`src/viewer-state.ts`):

- `ViewerState` gains `scrollLeft: number` (display-column units, default 0).
- `reduceViewer` viewport opts become `{ height: number; contentWidth: number }` where `contentWidth = innerWidth - gutterWidth`; the caller (`AnnotateCard`) computes it from the last rendered width.
- Cursor follow, applied after every cursor move and mode switch (vim `sidescrolloff=0` semantics):
  - `cursorDisplayCol < scrollLeft` -> `scrollLeft = cursorDisplayCol`
  - `cursorDisplayCol >= scrollLeft + contentWidth` -> `scrollLeft = cursorDisplayCol - contentWidth + 1`
- Clamp: `0 <= scrollLeft <= max(0, maxLineDisplayWidth - contentWidth)`, where `maxLineDisplayWidth` is the maximum display width across all loaded lines (computed once at file load). Re-clamped on every reduce (covers width changes) and again defensively at render time (covers terminal resizes with no keypress).
- No new keybindings: existing `h`/`l`/`0`/`$` and all line motions drive the follow logic. `zh`/`zl`/`zs`/`ze` are explicitly out (YAGNI).

Rendering (`src/viewer.ts`):

- The gutter (line number + Nerd Font icon) stays fixed; only the content area scrolls.
- Per content row: `renderLine` is unchanged (spans + inverse cursor cell computed on the full line in display-column coordinates); the styled result is then windowed: `sliceByColumn(styled, scrollLeft, contentWidth)` and padded to `contentWidth`.
- Implementation checkpoint: verify that pi-tui's `sliceByColumn` is ANSI-aware (slices a styled string by visible column without breaking escape sequences). If it is not, fall back to offsetting span columns by `-scrollLeft`, slicing the raw text, and applying styles inside the window (spans already use display-column coordinates, so this is mechanical).
- Overflow indicators: when the line extends past `scrollLeft + contentWidth`, the right edge keeps today's `...`; when `scrollLeft > 0`, the first content cell is replaced by a dim Nerd Font chevron. This mirrors vim's `listchars` behavior with `wrap` off - `extends:c` in the last column when the line continues beyond the right edge, `precedes:c` in the first visible column when text precedes it, both rendered with the dim-like `NonText` highlight.
- Because the cursor cell is styled before slicing and follow logic guarantees it is inside the window, the invisible-cursor defect is fixed by construction.

## Testing

- `test/viewer-state.test.ts`: follow past the right edge, follow back left, `$` on a long line, clamp at 0 and at the longest line, re-clamp on width change; `scrollLeft` resets appropriately on file reload.
- `test/status-line.test.ts` (new): left/right layout, truncation order, selection-range formats (`L:C-L:C`, `L-L`), cmdline hints rendering.
- `test/viewer.test.ts` (extend): styled slicing keeps ANSI styles and the cursor cell visible inside the window; overflow indicators appear/disappear at the right thresholds; gutter alignment unchanged; `normalizeKeyRepeat` rewrites repeat forms for arrows (`\x1b[1;1:2A` -> `\x1b[A`), functional keys (`\x1b[5;1:2~` -> `\x1b[5~`), and CSI-u (`\x1b[99;1:2u` -> `\x1b[99u`), keeps real modifiers (`\x1b[1;2:2A` -> `\x1b[1;2A`), and passes press/non-kitty input through unchanged.

## Explicitly out of scope

- `/` search (separate spec; the cmdline `input` variant is the only provision made here).
- Manual horizontal scroll keys (`zh`/`zl`/`zs`/`ze`), line wrapping, dynamic hint filtering.
- Moving the pending-draft count out of the title, scroll percentage.
