---
title: Viewer Markdown, Word Wrap, Pill Restyle, and Comment Caret - Implementation Plan
status: in-progress
progress: 0/9
spec: ../specs/2026-10-23-viewer-md-render-wrap-design.md
---

# Viewer Markdown, Word Wrap, Pill Restyle, and Comment Caret - Implementation Plan

**Goal:** Add raw-coordinate-preserving Markdown styling and word wrap to the annotation viewer, adapt movement and overlays to visual rows, restyle composer pills as `[<glyph> <basename><range>]` using the existing NF comment glyph `U+F075` (`nf-fa-comment`) without changing payload paths, and place the comment caret at the insertion point rather than on the preceding character.

**Architecture:** Pure display, Markdown scan, and wrap modules produce width-dependent visual rows whose every cell maps back to a raw UTF-16 position.
The reducer consumes precomputed current and alternate layouts for motion and toggles, while `AnnotateCard` owns scan caches, rendering, theme styles, and overlay placement.
The existing token store and payload pipeline remain intact; only the composer label and its collision spelling change.

**Tech stack:** TypeScript (`module: nodenext`, `.ts` import specifiers), `node:test`, `@earendil-works/pi-tui` (`Marked`, width-aware slicing, and theme helpers), and `@earendil-works/pi-coding-agent` theme tokens.

**Spec:** `docs/superpowers/specs/2026-10-23-viewer-md-render-wrap-design.md`, including the 2026-10-27 current-pill and comment-caret supplements plus the post-merge `^` correction.

**Execution:** Worktree `.pi/worktrees/viewer-md-render-wrap/`, branch `viewer-md-render-wrap`.
No implementation has started.

## Global constraints

- Raw `Position.line` / `Position.col` and `Range` stay authoritative and unchanged; visual rendering never writes display coordinates into selection or draft state.
- Phase 1 includes visible-marker Markdown styling and word wrap only; no image rendering, tables, LaTeX, fence-internal syntax highlighting, settings integration, g-family motions, or comment Markdown rendering.
- `wrapOn` and `renderOn` default ON per card session; `zr` is a no-op for non-`.md` files, and non-Markdown syntax highlighting stays on the existing `highlightCode` path.
- Wrap OFF plus render OFF must preserve the pre-feature renderer bit-for-bit except for the separately approved addition of `^`, the new pill label, and the comment-caret correction.
- Use `Marked` re-exported by `@earendil-works/pi-tui`; do not add dependencies or use the reflowing `Markdown` component.
- Preserve the one-way module layout `core <- tui <- viewer <- index.ts`; shared display types live in the TUI leaf and never import viewer types.
- Use ASCII in source and documents except UI-facing strings and their tests; use Unicode escapes for CJK and glyph fixtures where practical.
- Keep Markdown sentences on one line and semantic commit messages self-contained; never edit `package.json` version or `CHANGELOG.md`.
- Run targeted tests with `node --test <files>`, and run the complete suite with `node --test test/*.test.ts test/**/*.test.ts` plus `npx tsc --noEmit` before every task commit.
- Before each task commit, complete its review, tick its checkboxes, update plan `progress` and `STATUS.md` in the same commit, and keep the spec status `in-progress` once Task 1 starts.
- Task commits are local worktree checkpoints; final integration still requires the user's real-terminal E2E approval and the project's rebase plus fast-forward rules.

## Review Focus

1. Coordinate drift: raw selection ranges and comment insertion offsets must survive tabs, astral characters, wide CJK characters, prefixes, and wrap boundaries; Task 1 pins caret positions, and Tasks 3, 5, 6, and 8 pin round trips plus end-to-end extraction.
2. Broken wrap content: break spaces and punctuation must neither disappear nor duplicate, long tokens must hard-break, and empty or narrower-than-prefix lines must not overflow; Task 5 pins these cases.
3. Coordinate-space changes on resize and toggles: `scrollTop` means logical lines only in nowrap mode and visual rows in wrap mode, so `zw`, `zr`, resize, comment anchors, and `Alt+O` focus must remap through the cursor; Tasks 6, 7, and 8 cover them.
4. Unsafe Markdown assumptions: non-verbatim inline tokens, malformed references, nested blocks, code interiors, and narrow terminals must degrade cosmetically without throwing or moving the cursor; Tasks 4 and 7 cover them.
5. Pill identity regressions: equal basenames in different directories, NF display width, longest-token matching, and unchanged full payload paths must survive the label restyle; Task 2 covers them and Task 9 retains real-terminal verification.

## File structure

- `src/tui/comment-input.ts`: keep raw insertion offsets and align wrapping, movement, and caret-cell selection to the insertion point.
- `src/tui/card-chrome.ts`: allow the focused row-end caret to occupy one right-padding cell without changing row width.
- `src/core/message.ts`: share the NF annotation icon and produce basename-only token labels while leaving payload formatting unchanged.
- `src/core/store.ts`: retain live-token disambiguation with the new compact `~N` spelling.
- `src/tui/display.ts`: own shared span types, raw scan spans, `DisplayLine`, and `buildDisplayLine()` without importing viewer code.
- `src/viewer/line-style.ts`: re-export shared span types and compose Markdown styles with selection, search, and pending emphasis.
- `src/viewer/markdown.ts`: scan raw lines into fixed prefixes and verified raw-column style spans using `Marked`.
- `src/viewer/wrap.ts`: build visual rows and convert between raw and visual positions.
- `src/viewer/movement.ts` and `src/viewer/state.ts`: provide visual-row `keepVisible`, motions, counts, and `zw` / `zr` transitions while preserving nowrap behavior.
- `src/viewer/viewer.ts`: cache scans and layouts, apply theme styles, render logical or visual rows, and preserve focus and overlay anchors.
- `src/viewer/status-line.ts`: document `zw` and `zr` in normal-mode hints.
- `index.ts`: adapt the `tokenLabel()` call to its basename-specific signature.
- `test/**`: mirror each pure module and extend existing reducer, renderer, store, transform, editor, architecture, and index tests.
- `README.md`: document the new keys, rendering behavior, and pill format after implementation.

### Task 1: Place the comment caret at the insertion point

**Files:**
- Modify `src/tui/comment-input.ts`, `src/tui/card-chrome.ts`, and `src/viewer/viewer.ts`.
- Modify `test/tui/comment-input.test.ts`, `test/viewer/comment-mode.test.ts`, and `test/viewer/viewer.test.ts`.
- Create `test/tui/card-chrome.test.ts`.

Original done documents: [Comment Input Cursor Movement - Design](../specs/2026-10-22-comment-cursor-design.md) and [Comment Input Cursor Movement - Plan](2026-10-22-comment-cursor.md).
This task changes only their caret-cell and soft-wrap ownership decisions, replacing left-of-insertion cells with insertion-point rendering while preserving their hardware-cursor contract and full-row no-truncation requirements; the originals remain unchanged.

- [ ] **Step 1: Write failing insertion-caret and full-row regression tests**

Replace assertions that codify the old left-of-insertion model and pin at least these cases:

```ts
assert.deepEqual(cursorCellAt("abc", 1), { before: "a", cell: "b", after: "c" });
assert.deepEqual(cursorCellAt("abc", 3), { before: "abc", cell: " ", after: "" });
const boundary = wrapCommentLines("abcdef", 3, 3);
assert.equal(boundary.cursorRow, 1);
assert.equal(boundary.cursorCol, 0);
assert.equal(reduceComment({ text: "abcdef", caret: 4 }, { kind: "home" }, 3).state.caret, 3);
assert.deepEqual(reduceComment({ text: "abc", caret: 0 }, { kind: "home" }, 80).state, { text: "abc", caret: 0 });
```

Cover empty text, mid-text insertion, absolute end, CJK / emoji / combining clusters, hard newlines, soft-wrap boundaries, and vertical goal columns.
Replace the old up-to-full-row-boundary fixture with absolute-end and hard-newline full-row cases, and keep a separate soft-wrap one-press transition test.
Expect the full-row caret in the right-padding cell, exact 80-column rows, no ellipsis, and no lost marker.
Add a focused `frameCommentBox()` test proving only the marker-bearing row may use that extra cell and unfocused output remains byte-identical after ANSI stripping.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run `node --test test/tui/comment-input.test.ts test/viewer/comment-mode.test.ts test/tui/card-chrome.test.ts test/viewer/viewer.test.ts`.
Expect failures on the old left-character caret, previous-row boundary ownership, and last-interior-cell full-row behavior.

- [ ] **Step 3: Implement the insertion-point model without losing the earlier regression fixes**

Change `cursorCellAt()` to return the grapheme at the insertion column and return a blank cell after the row at end, following the pi-tui Editor model.
Make shared soft-wrap boundaries select the following row while hard-line and absolute text-end carets stay on their current row; keep `cursorCol` as the insertion display column.
Change `caretAtRowColumn()` to return the target grapheme's start offset, make Home target the bare row start and End the row end, and align vertical goal placement with the same mapping.
Preserve pure grapheme stepping for Left / Right and update all comments that currently describe the caret as painting the cluster it ends.
In `frameCommentBox()`, allow exactly one extra cell only on the `CURSOR_MARKER` row and reduce its right padding by that cell; all other rows keep the existing truncation budget and both padding cells.
Keep `CURSOR_MARKER + renderFakeCursor()` unchanged so hardware and fake cursor modes remain TUI-owned.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all insertion-point, one-press transition, exact-width, and pre-existing annotation tests to pass.

- [ ] **Step 5: Confirm focused real-terminal E2E, review, and commit**

In the minimal real-terminal sandbox, verify an empty comment, mid-text insertion, and end-of-text show the caret at the insertion point, including a blank cell to the right of the last typed character.
Repeat with wide graphemes, both hardware-cursor settings, full wrapped rows, and arrow / Home / End movement; confirm no ellipsis, border overflow, or swallowed one-press wrap transition.
After user confirmation, update bookkeeping and commit `fix(viewer): place comment caret at insertion point`.

### Task 2: Restyle composer pills without changing payload identity

**Files:**
- Modify `src/core/message.ts`, `src/core/store.ts`, `src/viewer/viewer.ts`, and `index.ts`.
- Modify `test/core/message.test.ts`, `test/core/store.test.ts`, `test/core/transform.test.ts`, `test/tui/editor.test.ts`, and `test/index.test.ts`.

- [ ] **Step 1: Write failing label, collision, transform, and recolor tests**

Use the exported `ANNOTATION_ICON` in expected strings rather than duplicating the glyph literal.
Pin at least these assertions:

```ts
assert.equal(tokenLabel("/repo/src/a.ts", range(9, 0, 19, 40), "line"), `[${ANNOTATION_ICON} a.ts:10-20]`);
assert.equal(tokenLabel("/repo/src/a.ts", range(9, 4, 9, 11), "char"), `[${ANNOTATION_ICON} a.ts:10:5-10:11]`);
assert.equal(tokenLabel("/etc/hosts", range(9, 0, 19, 0), "line"), `[${ANNOTATION_ICON} hosts:10-20]`);
```

Add two same-range drafts for `/repo/one/a.ts` and `/repo/two/a.ts` and expect tokens `[icon a.ts:10-10]` and `[icon a.ts:10-10~2]`, with no space before `~2`.
Keep the existing `formatPayload()` tests unchanged to prove payload paths remain `src/a.ts` or `/etc/hosts`.
Add NF-bearing `findTokenMatches()`, `expandTokens()`, `lastTokenIn()`, longest-first `recolorTokens()`, and visible-width preservation tests.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run `node --test test/core/message.test.ts test/core/store.test.ts test/core/transform.test.ts test/tui/editor.test.ts`.
Expect failures on the old directory-qualified labels and old ` ~N` suffix spelling.

- [ ] **Step 3: Implement the shared glyph and basename label**

Export `ANNOTATION_ICON = "\u{F075}"` from `src/core/message.ts` and keep `PENDING_ICON` in `viewer.ts` as an alias so existing viewer imports and tests remain valid.
Change the signature to `tokenLabel(absPath: string, range: Range, mode: VisualMode): string`, use `path.basename(absPath)`, and update `index.ts` plus test callers.
Change store suffix parsing and generation from ` ~N` to `~N`, preserving the next-free-number behavior among live drafts.
Reword the stale MVP-era header comment so it describes the current token and payload contracts rather than an immutable token-format freeze.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, then `node --test test/*.test.ts test/**/*.test.ts` and `npx tsc --noEmit`.
Expect all tests and typecheck to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(composer): restyle annotation pills` with the code, tests, and SDD updates.

### Task 3: Add a coordinate-preserving display model

**Files:**
- Modify `src/tui/display.ts` and `src/viewer/line-style.ts`.
- Create `test/tui/display.test.ts` and `test/viewer/line-style.test.ts`.

- [ ] **Step 1: Write failing display-line and style-composition tests**

Test this exact interface and geometry:

```ts
const line = buildDisplayLine("a\tb", {
  prefix: "> ",
  prefixStyle: "mdQuoteBorder",
  spans: [{ startCol: 2, endCol: 3, style: "mdBold" }],
});
assert.equal(line.text, "> a   b");
assert.equal(line.prefixWidth, 2);
assert.deepEqual(line.spans.at(-1), { start: 6, end: 7, style: "mdBold" });
```

Also cover an empty prefix, an ANSI-highlighted base whose visible width is unchanged, unsorted raw spans, and a zero-width raw span being omitted.
Add `applyStyleSpans()` cases proving Markdown styles compose with `target`, `match`, and `inverse` rather than entering the pending-emphasis precedence race.

- [ ] **Step 2: Run the new tests and confirm RED**

Run `node --test test/tui/display.test.ts test/viewer/line-style.test.ts`.
Expect missing exports and missing Markdown style behavior.

- [ ] **Step 3: Implement shared types and `buildDisplayLine()`**

Move `SpanStyle` and `StyleSpan` to `src/tui/display.ts`, re-export them from `line-style.ts`, and add these Markdown styles: `mdDim`, `mdBold`, `mdItalic`, `mdStrike`, `mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, and `mdListBullet`.
Define:

```ts
export interface RawStyleSpan { startCol: number; endCol: number; style: SpanStyle }
export interface DisplayScanLine { prefix?: string; prefixStyle?: SpanStyle; spans?: RawStyleSpan[] }
export interface DisplayLine { raw: string; text: string; prefixWidth: number; spans: StyleSpan[] }
export function buildDisplayLine(raw: string, scan?: DisplayScanLine, highlighted?: string): DisplayLine
```

`highlighted` is the existing per-line tab-expanded ANSI base; otherwise use `tabExpanded(raw)`.
Sort copies of raw spans, map their columns in one batch, add `prefixWidth`, prepend the prefix and its optional span, and never mutate the scan input.
Extend `applyStyleSpans()` so every Markdown style composes independently while existing inverse, search, and pending precedence remains unchanged.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all tests to pass and no architecture violations.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(tui): add coordinate-preserving display lines`.

### Task 4: Implement the verbatim-verified Markdown scanner

**Files:**
- Create `src/viewer/markdown.ts` and `test/viewer/markdown.test.ts`.
- Modify `src/AGENTS.md` and `test/architecture.test.ts`.

- [ ] **Step 1: Write failing scanner golden tests**

Assert one `DisplayScanLine` per input raw line for every phase-1 construct:

```ts
const heading = scanMarkdown(["# head"])[0];
assert.deepEqual(heading.spans, [
  { startCol: 0, endCol: 2, style: "mdDim" },
  { startCol: 2, endCol: 6, style: "mdHeading" },
]);
```

Cover ATX and setext headings; bold, emphasis, strike, code spans, links, and escapes; fenced and indented code with no inline styling inside; thematic breaks; ordered and unordered lists; quote plus list nesting with additive prefix widths; hanging-indent continuation lines; link reference definitions and images wholly dimmed; and entities, raw HTML, tables, and LaTeX left plain.
Include a link-class non-verbatim fixture and malformed input and assert the affected inline span is dropped without throwing or changing line count.
Add `viewer/markdown.ts` to the architecture sanity list.

- [ ] **Step 2: Run scanner and architecture tests and confirm RED**

Run `node --test test/viewer/markdown.test.ts test/architecture.test.ts`.
Expect the module and scanner to be absent.

- [ ] **Step 3: Implement `scanMarkdown()`**

Export `scanMarkdown(lines: string[]): DisplayScanLine[]` from `src/viewer/markdown.ts`.
Use `new Marked().lexer(lines.join("\n"))`, locate block token `raw` only at verified raw line boundaries, and derive each line's literal prefix plus raw UTF-16 spans.
Accept inline token `raw` only through a forward-only verbatim cursor; on mismatch drop that span and continue with plain text.
Skip table tokens and all inline styling inside code, catch lexer failures into an all-plain scan, and never reflow, hide, normalize, or concatenate raw source lines.
Document the new viewer module in `src/AGENTS.md`.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all golden scans and architecture checks to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(viewer): scan markdown without reflowing source`.

### Task 5: Build word wrap and raw/visual mapping

**Files:**
- Create `src/viewer/wrap.ts` and `test/viewer/wrap.test.ts`.
- Modify `src/AGENTS.md` and `test/architecture.test.ts`.

- [ ] **Step 1: Write failing wrap and round-trip tests**

Pin raw boundaries as well as rendered text:

```ts
const layout = buildVisualLayout(lines, displays, 3);
assert.deepEqual(layout.rows.map((r) => [r.line, r.startCol, r.endCol]), [
  [0, 0, 3], [0, 3, 6], [0, 6, 8],
]);
```

Use an unbreakable `abcdefgh` for the example above and assert rows `abc`, `def`, and `gh`.
Cover `alpha beta gamma` at width 10 with every break space preserved exactly once; CJK breaks using escaped fixtures; a wide character exactly at the boundary and one that cannot fit the remaining cell; repeated prefixes on continuation rows; an empty logical line; a zero or narrow width; and a prefix narrower, equal to, and wider than the viewport.
Assert concatenating raw `[startCol, endCol)` slices reproduces each original line exactly.
Round-trip `toVisualPosition()` and `toRawPosition()` across tabs, prefix cells, astral characters, intermediate break boundaries, and logical EOL; a display column inside a prefix maps to `row.startCol`.
Add `viewer/wrap.ts` to the architecture sanity list.

- [ ] **Step 2: Run wrap and architecture tests and confirm RED**

Run `node --test test/viewer/wrap.test.ts test/architecture.test.ts`.
Expect the module and mapping functions to be absent.

- [ ] **Step 3: Implement the layout and mapping API**

Export:

```ts
export interface VisualRow {
  line: number;
  startCol: number;
  endCol: number;
  continuation: boolean;
  prefixWidth: number;
  text: string;
  spans: StyleSpan[];
}
export interface VisualLayout {
  rows: VisualRow[];
  firstRowByLine: number[];
  maxLineWidth: number;
}
export function buildVisualLayout(lines: string[], displays: DisplayLine[], width: number): VisualLayout
export function toVisualPosition(lines: string[], layout: VisualLayout, pos: Position): { row: number; col: number }
export function toRawPosition(lines: string[], layout: VisualLayout, row: number, displayCol: number): Position
```

Walk grapheme boundaries with global tab-expanded raw columns; prefer a break after Latin whitespace or punctuation, allow breaks between CJK graphemes, and otherwise hard-break at the greatest whole-grapheme boundary that fits.
Keep the break character on the preceding row, emit at least one row per logical line, and never split a wide grapheme.
Repeat the block prefix on continuation rows, slice existing ANSI text and display spans into row-local coordinates, and compute `maxLineWidth` from the unwrapped display lines.
Clamp width to at least one content cell and drop or truncate only cosmetic prefix cells when they cannot fit; raw mapping and text content must remain lossless.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all wrap, mapping, and architecture tests to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(viewer): add raw-mapped word wrap`.

### Task 6: Adapt reducer motion and `zw` / `zr` transitions

**Files:**
- Modify `src/viewer/movement.ts`, `src/viewer/state.ts`, `test/viewer/movement.test.ts`, and `test/viewer/state.test.ts`.

- [ ] **Step 1: Write failing visual-motion and toggle tests**

Build small real layouts through Task 5 and pass them through the new optional viewport display field.
Pin these behaviors:

- `j` / `k` and arrow keys move by visual row with count and preserve an unclamped display goal across short rows and prefixes.
- `h` / `l` keep raw-count motion, cross segment boundaries without horizontal scrolling, and preserve logical-line clamping.
- `0` and `$` keep logical-line semantics; the new `^` arm moves to the first raw non-whitespace character in both wrap modes.
- Plain `G` targets the last visual row, `{count}G` targets the 1-based visual row, `gg` targets the first, and `ctrl+d` / `ctrl+u` and PageUp / PageDown use visual-row distances; these jumps preserve the current visual column through `toRawPosition()`.
- `:N` remains a logical-line address, and `n` / `N` still jump to raw match positions before visual `keepVisible` runs.
- `zw` preserves cursor and anchor, flips `wrapOn`, remaps `scrollTop` between logical and visual coordinates while preserving the cursor's viewport offset, and resets `wantedCol` plus `scrollLeft` appropriately.
- `zr` performs the same remap through the alternate layout, while `zr` on a non-Markdown viewport is an exact no-op.
- Missing optional flags mean ON, while a viewport with no display layouts retains every existing reducer test and horizontal-scroll expectation.

- [ ] **Step 2: Run reducer tests and confirm RED**

Run `node --test test/viewer/movement.test.ts test/viewer/state.test.ts`.
Expect missing display-layout types, visual motion, and `z` handling.

- [ ] **Step 3: Implement visual `keepVisible`, motions, and toggles**

Add optional `wrapOn` and `renderOn` state fields and this optional viewport field:

```ts
export interface ViewerDisplayModes {
  current: VisualLayout;
  alternate: VisualLayout;
  canToggleRender: boolean;
}
```

Add `display?: ViewerDisplayModes` to `ViewerViewport` so legacy test viewports continue to select the nowrap path.
Use visual motion only when `wrapOn !== false` and layouts are present; otherwise retain the current code path byte-for-byte.
Split `keepVisible` into visual vertical following with `scrollLeft = 0` and the existing logical-line plus horizontal path.
Use `wantedCol` as raw columns in nowrap mode and display columns in wrap mode, resetting it on toggles exactly as existing mode transitions reset it.
Add `moveVisual()` for row deltas and visual goals, add the `^` raw first-non-whitespace arm, and generalize pending two-stroke handling for `gg`, `zw`, and `zr` without adding any g-family motion.
`zw` uses the current layout for remapping and `zr` uses `current` versus `alternate`; both preserve raw cursor and anchor and re-run `keepVisible` after choosing the target coordinate space.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all new and pre-existing reducer tests to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(viewer): add visual-row motions and display toggles`.

### Task 7: Integrate layouts, Markdown themes, and visual-row rendering

**Files:**
- Modify `src/viewer/viewer.ts`, `src/viewer/status-line.ts`, `test/viewer/viewer.test.ts`, and `test/viewer/status-line.test.ts`.

- [ ] **Step 1: Write failing renderer and resize tests**

Add Markdown fixtures for every scanner style, nested quote plus list prefixes, code background, links, reference definitions, images, and raw table / HTML / entity text.
Assert production `wrapOn` and `renderOn` default ON, `zw` and `zr` re-render live, and `zr` is inert for non-`.md` paths.
Add a wrap-OFF plus render-OFF byte-equivalence snapshot and update only horizontal-scroll-specific legacy tests to disable wrap explicitly.
Assert continuation visual rows have a blank line-number gutter and do not duplicate pending counts, every row satisfies `visibleWidth(row) <= width`, and repeated narrow / wide renders rebuild rows and clamp the viewport without stale cache entries.
Pin the normal hints to:

```text
hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  zw wrap  zr render  :q close
```

- [ ] **Step 2: Run viewer and status-line tests and confirm RED**

Run `node --test test/viewer/viewer.test.ts test/viewer/status-line.test.ts`.
Expect missing visual rows, Markdown styling, toggles, and hints.

- [ ] **Step 3: Implement cached display modes and visual rendering**

Initialize `wrapOn: true` and `renderOn: true` in the card state.
Scan Markdown once per file and cache current and alternate `VisualLayout` objects by content width and render mode; use the plain display model for non-Markdown files and for render OFF, retaining the existing `highlighted` cache.
Build the viewport passed to the reducer from the same cached current and alternate layouts used by rendering.
Implement `renderVisualRow()` with row-local spans, no `sliceWindow`, blank continuation gutters, and an inverse virtual EOL cell only on the logical line's final segment.
Keep nowrap rendering on `renderRow()` with only the prefix and display-style additions; horizontal clamp uses the current layout's `maxLineWidth`.
Use these theme mappings and no unverified color names:

| Span style | Renderer |
| --- | --- |
| `mdDim` | `colors.dim` |
| `mdBold` / `mdItalic` / `mdStrike` | `theme.bold` / `theme.italic` / `theme.strikethrough` |
| `mdHeading` | `theme.fg("mdHeading", theme.bold(text))` |
| `mdLink` | `theme.fg("mdLink", theme.underline(text))` |
| `mdLinkUrl` | `colors.dim(theme.fg("mdLinkUrl", text))` |
| `mdCode` | `theme.fg("mdCode", text)` |
| `mdCodeBlock` | `theme.bg("selectedBg", theme.fg("mdCodeBlock", text))` |
| `mdCodeBlockBorder` | `colors.dim(theme.fg("mdCodeBlockBorder", text))` |
| `mdQuote` | `theme.fg("mdQuote", text)` |
| `mdQuoteBorder` | `theme.fg("mdQuoteBorder", text)` |
| `mdHr` | `theme.fg("mdHr", text)` |
| `mdListBullet` | `theme.fg("mdListBullet", text)` |

Update the test theme harness for italic and strikethrough and add the normal-mode hints above.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all renderer, resize, and equivalence tests to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(viewer): render markdown and wrapped visual rows`.

### Task 8: Preserve annotations, search, overlays, and focus in visual rows

**Files:**
- Modify `src/viewer/viewer.ts` and `test/viewer/viewer.test.ts`.

- [ ] **Step 1: Write failing interaction-geometry tests**

Select across at least one wrap boundary and submit a comment; assert the emitted `Range` is the expected raw UTF-16 range and the snapshot is unchanged raw text.
Verify selection, pending underline / target emphasis, cursor, and current / ordinary search matches intersect and paint each visual segment correctly with prefixes, tabs, and CJK input.
Assert statusline cursor and selection positions remain raw logical positions without a Markdown prefix.
Anchor the comment editor and hover preview to the correct visual row and display cell, including a continuation row and a zero-horizontal-scroll wrap layout.
Extend jump-back focus tests so constructor-time checks remain valid and the first actual-width render recenters a wrapped target visual row; retain shortened-file clamping and no-focus opening-at-top behavior.

- [ ] **Step 2: Run interaction tests and confirm RED**

Run `node --test test/viewer/viewer.test.ts`.
Expect failures where raw line numbers were treated as visual rows or raw columns lacked prefix / segment mapping.

- [ ] **Step 3: Implement shared annotation mapping through visual rows**

Make `displaySpan()` prefix-aware in nowrap mode and intersect selection and pending ranges with each `VisualRow`'s `[startCol, endCol)` window in wrap mode.
Compute search matches on raw lines exactly as today, then map them through the same prefix and segment path before applying interaction styles.
Map comment and preview anchors with `toVisualPosition()` while keeping their existing raw anchor data and `commentBoxPlacement()` inputs.
Recenter a pending jump-back focus against the actual first-render layout while preserving the constructor's fail-open raw cursor clamp.
Keep extraction, pending store identity, statusline coordinates, and comment payload rendering unchanged.

- [ ] **Step 4: Run focused and full verification**

Run the Step 2 command, the full suite, and typecheck.
Expect all interaction, payload, overlay, and focus tests to pass.

- [ ] **Step 5: Review and commit**

Update bookkeeping and commit `feat(viewer): preserve annotation mapping in visual rows`.

### Task 9: Document and run the real-terminal acceptance pass

**Files:**
- Modify `README.md`, `docs/superpowers/specs/2026-10-23-viewer-md-render-wrap-design.md`, `docs/superpowers/plans/2026-10-27-viewer-md-render-wrap.md`, and `docs/superpowers/STATUS.md` only for final status and completion records.

- [ ] **Step 1: Update user documentation**

Document default word wrap and Markdown styling, `zw`, `zr`, and `^` in Features and Keys, remove Basic Markdown from Roadmap, and update every composer pill example to the new NF-glyph basename format.
State that source selections and payload ranges remain raw and that wrap OFF plus render OFF restores the source-style view.
Do not add a version bump or changelog entry.

- [ ] **Step 2: Run the complete automated gate**

Run `node --test test/*.test.ts test/**/*.test.ts` and `npx tsc --noEmit`.
Expect all tests, document-index checks, architecture checks, and typecheck to pass.

- [ ] **Step 3: Prepare `/tmp` fixtures and run manual E2E**

Create Markdown and plain-text fixtures only under `/tmp` with nested quote / list blocks, fenced code, links, a reference definition, an image, a table, long Latin tokens, CJK and wide characters at exact boundaries, tabs, and character ranges crossing wraps.
Launch the minimal sandbox from the worktree with `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`.
Verify default ON behavior, live `zw` / `zr`, `zr` on non-Markdown input, resize re-wrap, `0` / `$` / `^`, visual `j` / `k` / `G` / `gg` / paging, exact annotation extraction, search and pending emphasis, comment / preview anchors, and `Alt+O` focus.
Verify the new pill glyph, basename collisions, cursor alignment, composer wrapping, and unchanged payload paths; do not claim the existing wrapped-token recolor limitation is fixed without evidence.
Recheck the comment caret at empty, middle, absolute-end, wide-grapheme, hard-newline, and full-wrap-row positions with both hardware-cursor settings.

- [ ] **Step 4: Require real-terminal verification**

The user must confirm the E2E in a real terminal, explicitly including kitty key repeat on `j` / `k` in wrap mode and NF glyph width.
Do not substitute tmux or unit tests for terminal-dependent acceptance and do not mark this step complete from an agent-run sandbox alone.

- [ ] **Step 5: Final review and completion bookkeeping**

After user approval, update final checkboxes, set plan `progress: 9/9` and `status: done`, set the linked spec `status: done`, and move both paths to the STATUS Done section in the same commit.
Commit `docs: document viewer rendering acceptance` with the README and completion records, then follow the separate branch-finishing workflow for rebase, fast-forward integration, and worktree cleanup.
