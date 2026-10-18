---
status: done
progress: 6/6
---

# Statusline + Horizontal Scroll - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the annotate card's static footer into a two-row statusline + cmdline area (mode badge and cursor position), add horizontal scrolling to the content area (fixing the invisible cursor past the right edge of long lines), and fix held arrow keys not repeating under the kitty keyboard protocol.

**Architecture:** New pure-rendering module `src/status-line.ts` (two pure functions for the statusline and cmdline rows); `ViewerState` gains `scrollLeft` and the reducer's viewport opts become `{height, contentWidth, maxLineWidth}`; rendering windows the already-styled line with pi-tui's ANSI-aware `sliceByColumn`; `handleInput` normalizes kitty repeat sequences to press form via a pure `normalizeKeyRepeat` function.

**Tech stack:** TypeScript (jiti, no build step), pi-tui (Component interface, `sliceByColumn`/`truncateToWidth`/`visibleWidth`/`matchesKey`), node --test.

**Spec:** `docs/superpowers/specs/2026-10-18-statusline-and-hscroll-design.md` (status: approved) - the plan assumes the spec's decisions; implementers read both.

## Global constraints

- All code, comments, test names, and commit messages in English; no non-ASCII characters in files except UI strings (Nerd Font icons allowed there).
- Semantic commits (`feat(<component>): ...` / `refactor(<component>): ...` / `fix(<component>): ...`).
- Test commands: single file `node --test test/<file>.test.ts`, full suite `npm test`; typecheck `npx tsc --noEmit`.
- Never touch `package.json` `"version"` or `CHANGELOG.md` (managed by release-please).
- Statusline strings verbatim from the spec: badges stay `-- NORMAL --` / `-- VISUAL --` / `-- VISUAL LINE --` / `-- COMMENT --`; position format `L:C` (1-based, C is the display column after tab expansion); visual-char selection `L:C-L:C`, visual-line selection `L-L`.
- Clamp upper bound: `max(0, maxLineWidth - contentWidth + 1)` (the `+1` covers the virtual cursor cell when the end-exclusive cursor sits at end of line).
- Cursor follow (vim `sidescrolloff=0` semantics): if `displayCol < scrollLeft` then `scrollLeft = displayCol`; if `displayCol >= scrollLeft + contentWidth` then `scrollLeft = displayCol - contentWidth + 1`.

## Review Focus

1. Terminal resize without a keypress leaves `scrollLeft` stale and the cursor gets clipped again - expect: render-time defensive clamp; pinned by the "render-time clamp" test in Task 4.
2. Wide characters (CJK/emoji) straddling the window's right edge - expect: no half-width-character rendering, row width exactly `contentWidth`; pinned by `sliceByColumn(..., strict=true)` plus a Task 4 test.
3. Comment box / preview anchored by file coordinates after horizontal scrolling, pushing the box off-panel - expect: `selCol` minus `scrollLeft`; pinned by the Task 4 comment-box test.
4. Bracketed-paste bracket sequences `\x1b[200~` / `\x1b[201~` mangled by repeat normalization - expect: pass through unchanged; pinned by Task 2 tests.
5. `$` on a tab-heavy line - expect: follow logic computed in display columns, cursor visible; pinned by the Task 3 tab test.

---

### Task 1: Extract the display-column helper module

`reduceViewer` (a pure function) needs tab-expanded display-column math for horizontal follow, but that helper currently lives in `src/viewer.ts` and viewer-state must not depend back on viewer. Extract it into a leaf module both sides import.

**Files:**
- Create: `src/display.ts`
- Modify: `src/viewer.ts:24,63,83` (`DEFAULT_TAB_SIZE`, `tabExpanded`, `rawColToDisplayCol` move out of here)
- Modify: import sites of those three symbols in `test/viewer.test.ts` (if any)

- [x] **Step 1: Create `src/display.ts`**

Move `DEFAULT_TAB_SIZE = 4`, `tabExpanded(s, tabSize?)`, `rawColToDisplayCol(line, col, tabSize?)` - including their doc comments - verbatim into `src/display.ts` and export them; `src/viewer.ts` switches to `import { ... } from "./display.ts"` (no re-export; update all import sites). Zero behavior change, pure move.

- [x] **Step 2: Run the full suite to verify no regression**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, typecheck clean (same as before the change)

- [x] **Step 3: Commit**

```bash
git add src/display.ts src/viewer.ts test/
git commit -m "refactor(viewer): extract display-column helpers into src/display.ts"
```

---

### Task 2: Key-repeat normalization

**Files:**
- Modify: `src/viewer.ts` (new `normalizeKeyRepeat`, wired at the top of `handleInput`)
- Test: `test/viewer.test.ts`

- [x] **Step 1: Write the failing test**

Add a `normalizeKeyRepeat` group to `test/viewer.test.ts` (import from `../src/viewer.ts`):

```ts
// kitty repeat -> press equivalents
assert.equal(normalizeKeyRepeat("\x1b[1;1:2A"), "\x1b[A");   // up
assert.equal(normalizeKeyRepeat("\x1b[1;1:2B"), "\x1b[B");   // down
assert.equal(normalizeKeyRepeat("\x1b[1;1:2D"), "\x1b[D");   // left
assert.equal(normalizeKeyRepeat("\x1b[1;1:2C"), "\x1b[C");   // right
assert.equal(normalizeKeyRepeat("\x1b[5;1:2~"), "\x1b[5~");  // PgUp
assert.equal(normalizeKeyRepeat("\x1b[6;1:2~"), "\x1b[6~");  // PgDn
assert.equal(normalizeKeyRepeat("\x1b[99;1:2u"), "\x1b[99u"); // CSI-u 'c'
// real modifiers are kept, only the event field is stripped
assert.equal(normalizeKeyRepeat("\x1b[1;2:2A"), "\x1b[1;2A"); // shift+up
assert.equal(normalizeKeyRepeat("\x1b[5;5:2~"), "\x1b[5;5~"); // ctrl+PgUp
// pass-through: presses, releases (filtered upstream anyway), plain text,
// and bracketed-paste brackets must survive untouched
assert.equal(normalizeKeyRepeat("\x1b[A"), "\x1b[A");
assert.equal(normalizeKeyRepeat("\x1b[200~"), "\x1b[200~");
assert.equal(normalizeKeyRepeat("\x1b[201~"), "\x1b[201~");
assert.equal(normalizeKeyRepeat("h"), "h");
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test test/viewer.test.ts`
Expected: FAIL with `normalizeKeyRepeat is not a function` (or a missing-export compile/import error)

- [x] **Step 3: Implement `export function normalizeKeyRepeat(data: string): string` in `src/viewer.ts`**

Rule: rewrite only when the entire input is exactly one kitty sequence carrying event type 2 (letter-final `\x1b[<n>;<mod>:2X`, tilde form `\x1b[<n>;<mod>:2~`, CSI-u form `\x1b[<cp>;<mod>:2u`; single anchored match, not a global replace) - drop `:2`; when the modifier field is 1, drop `;1` as well (for the letter form, if the remaining parameter is just `1`, drop the whole parameter section, yielding `\x1b[A` rather than `\x1b[1A`). Everything else returns unchanged.

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test test/viewer.test.ts`
Expected: PASS

- [x] **Step 5: Wire into `handleInput`**

First line of `AnnotateCard.handleInput` becomes `data = normalizeKeyRepeat(data);`, before the existing escape/ctrl+j normalization.

- [x] **Step 6: Commit**

```bash
git add src/viewer.ts test/viewer.test.ts
git commit -m "fix(viewer): treat kitty key-repeat sequences as presses so held arrow keys scroll"
```

---

### Task 3: Horizontal scrolling in the state machine

**Files:**
- Modify: `src/viewer-state.ts:13-17` (`ViewerState`), `:125-139` (`keepVisible`/`moved`), `:289-299` (`reduceViewer` signature)
- Modify: `src/viewer.ts` (`handleInput` passes the new viewport opts; new `maxLineWidth` cache)
- Test: `test/viewer-state.test.ts`

- [x] **Step 1: Write the failing tests**

Add a group to `test/viewer-state.test.ts` (state construction follows the file's existing fixture style; `vp` denotes the new viewport argument):

```ts
// follow right: cursor display col walks past the window's right edge
// lines = ["x".repeat(100)], vp = {height: 5, contentWidth: 10, maxLineWidth: 100}
// press "l" ten times from col 0 -> cursor.col 10, scrollLeft 1
// follow left: from that state press "h" ten times -> scrollLeft back to 0
// "$" on the long line -> cursor.col 100 (end-exclusive), scrollLeft 91
//   (follow target 100 -> 100 - 10 + 1 = 91; clamp max(0, 100 - 10 + 1) = 91)
// clamp: stale scrollLeft 500 with the same file -> 91
// empty-ish file: lines = ["ab"], any motion -> scrollLeft stays 0
// tabs: lines = ["\t" + "x".repeat(50)], tabSize 4: cursor to col 1
//   (display col 4), cw 4 -> scrollLeft 1 (display col 4 >= 0 + 4)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/viewer-state.test.ts`
Expected: FAIL (`scrollLeft` assertions unmet / viewport type errors)

- [x] **Step 3: Implement**

- `ViewerState` gains `scrollLeft?: number` (`undefined` means 0; follows the `editingDraftId` optional-field precedent to avoid churning existing test fixtures).
- New `export interface ViewerViewport { height: number; contentWidth: number; maxLineWidth: number }`; `reduceViewer`'s 4th parameter changes from `{ height: number }` to `ViewerViewport`.
- `keepVisible` appends horizontal follow and clamping after the existing vertical logic (numeric rules in "Global constraints"; display col computed with `rawColToDisplayCol(line, cursor.col)` from Task 1); `moved` and every `keepVisible` call site inside `reduceViewer` pass the viewport through.
- `src/viewer.ts`: `AnnotateCard` computes `this.maxLineWidth = max over lines of rawColToDisplayCol(line, line.length)` once at construction / file load; new `private contentWidth()` (= the `inner` cached from the latest `render(width)` minus `gutterWidth(this.file.lines.length)`; if never rendered yet, fall back to an estimate from the same terminal-width source `viewportHeight()` uses); in `handleInput`, `{ height: this.viewportHeight() }` becomes `{ height: this.viewportHeight(), contentWidth: this.contentWidth(), maxLineWidth: this.maxLineWidth }`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test test/viewer-state.test.ts && npx tsc --noEmit`
Expected: PASS (existing cases pass after adapting to the new signature)

- [x] **Step 5: Commit**

```bash
git add src/viewer-state.ts src/viewer.ts test/viewer-state.test.ts
git commit -m "feat(viewer-state): horizontal cursor-follow scrolling with scrollLeft"
```

---

### Task 4: Content window rendering + ~~overflow indicators~~ + overlay anchor fix  (indicators deprecated post-merge, see Amendment)

**Files:**
- Modify: `src/viewer.ts` (the row-rendering loop in `render`, `selCol` in `paintCommentBox`)
- Test: `test/viewer.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
// Render a card with scrollLeft=5 (wide lines + narrow panel):
// - content rows show the window starting at display col 5; the gutter
//   (line-number column) stays fixed on the left
// - first content cell is the dim NF left indicator (scrollLeft > 0)
// - rows still end with "..." when content extends past the window's right edge
// - the inverse cursor cell is visible inside the window (state cursor in-window)
// - a wide char straddling the right edge is not half-rendered; the row's
//   visibleWidth is exactly `inner`
// - render-time clamp: a state whose scrollLeft is far beyond the bound renders
//   without overflow and without throwing
// - comment box: entering comment mode with scrollLeft=10 keeps the box inside
//   the panel (commenting out the scrollLeft correction pushes it off-panel)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/viewer.test.ts`
Expected: FAIL (current implementation has no windowing / no left indicator)

- [x] **Step 3: Implement**

- Render-time safety: `const sl = clampScrollLeft(this.state.scrollLeft ?? 0)` (upper bound `max(0, this.maxLineWidth - contentWidth + 1)`, lower bound 0).
- ~~The indicators mirror vim's `listchars` `extends`/`precedes` semantics with `wrap` off (dim like `NonText`); keep the indicator characters as specified.~~ **Deprecated:** vim's default `listchars` enables neither; removed post-merge (see Amendment below).
- Row rendering changes from `truncateToWidth(gutter + renderLine(...), inner, "...", true)` to: first window the full styled result of `renderLine(...)` via `sliceByColumn(styled, sl + leftPad, contentWidth - leftPad - rightPad, true)` (`strict=true` so no half wide char), where `leftPad` = `sl > 0 ? 1 : 0` and `rightPad` = `3` when content extends past the window's right edge, else `0`; then join `gutter + (sl > 0 ? colors.dim(<NF chevron>) : "") + windowed + (right overflow ? colors.dim("...") : "")` and space-pad to `inner`. `contentWidth` matches Task 3's `contentWidth()`. Right-overflow test: `rawColToDisplayCol(line, line.length) > sl + contentWidth`.
- The inverse cursor cell is rendered inside `renderLine`, before slicing; the follow logic (Task 3) guarantees it sits inside the window - no extra handling.
- `paintCommentBox`'s `selCol` becomes `gutterWidth(...) + rawColToDisplayCol(...) - sl` (if `overlayPreview` goes through the same function it is covered automatically; verify and fix its anchor path too).

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test test/viewer.test.ts && npm test`
Expected: PASS (full suite green)

- [x] **Step 5: Commit**

```bash
git add src/viewer.ts test/viewer.test.ts
git commit -m "feat(viewer): render horizontally scrolled content window with overflow indicators"
```

---

### Task 5: status-line module + card-chrome slimming + multi-row panel footers

**Files:**
- Create: `src/status-line.ts`
- Modify: `src/card-chrome.ts:23-27` (`PanelOptions`), `:61` (`framePanel`), `:137-159` (`CardMode`/`FooterHints`/`FOOTER_HINTS` move out)
- Test: create `test/status-line.test.ts`; modify `test/card-chrome.test.ts` (FOOTER_HINTS section migrates, framePanel footer cases switch to `footers`)

- [x] **Step 1: Write the failing tests (`test/status-line.test.ts`)**

```ts
import { renderStatusLine, renderCommandLine, FOOTER_HINTS, cardModeOf } from "../src/status-line.ts";

// renderStatusLine: badge on the left (accent-wrapped), "12:4" on the right
//   (dim-wrapped), whole row's visibleWidth == inner
// visual-char: "-- VISUAL --  8:1-12:4" on the left, position still on the right
// visual-line: selection renders as "8-12"
// narrow-width degradation: the selection segment is dropped first, badge and
//   position are always preserved (at least one space of gap between them)
// cardModeOf: "visual-char" -> "visualChar", "visual-line" -> "visualLine",
//   "normal"/"comment" unchanged
// renderCommandLine hints: content == FOOTER_HINTS[mode].hints (dim), truncated
//   from the right when too wide
// renderCommandLine input (interim): renders prompt + value, truncated right
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/status-line.test.ts`
Expected: FAIL (module does not exist)

- [x] **Step 3: Create `src/status-line.ts`**

- Move `CardMode`, `FooterHints`, `FOOTER_HINTS` (strings verbatim) in from `card-chrome.ts`, and `cardModeOf` in from `viewer.ts:157-161` (export it).
- New types and functions (signatures fixed, bodies up to the implementer):

```ts
export interface StatusLineInput {
  mode: CardMode;
  cursor: { line: number; col: number }; // 1-based, col is display columns
  selection?: { start: { line: number; col: number }; end: { line: number; col: number }; kind: "char" | "line" } | null;
}
export type CommandLineInput =
  | { kind: "hints"; mode: CardMode }
  | { kind: "input"; prompt: string; value: string; cursorCol: number };
export function renderStatusLine(input: StatusLineInput, innerWidth: number, colors: ChromeColors): string;
export function renderCommandLine(input: CommandLineInput, innerWidth: number, colors: ChromeColors): string;
```

The `input` variant only renders `prompt + value` (truncated) for now; the inverse cursor cell lands with the search spec. Note this in a comment.

- [x] **Step 4: Slim card-chrome + framePanel interface**

- Delete the three moved symbols from `card-chrome.ts`; `PanelOptions.footer?: string` becomes `footers?: string[]`, and `framePanel` renders each footer as one inner row in order (reuse the existing `innerRow`).
- `test/card-chrome.test.ts`: the FOOTER_HINTS section moves wholesale to `test/status-line.test.ts` (imports updated); framePanel footer cases switch to `footers: [...]` and gain a "two footers produce two inner rows" case.

- [x] **Step 5: Run the tests to verify they pass**

Run: `node --test test/status-line.test.ts && node --test test/card-chrome.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/status-line.ts src/card-chrome.ts test/status-line.test.ts test/card-chrome.test.ts
git commit -m "feat(status-line): add statusline/cmdline renderers and multi-row panel footers"
```

---

### Task 6: Viewer wiring + wrap-up

**Files:**
- Modify: `src/viewer.ts:38` (`CHROME_ROWS`), the footer assembly section of `render`
- Modify: `docs/superpowers/STATUS.md`, this plan's front-matter and checkboxes
- Test: `test/viewer.test.ts` (footer assertions updated)

- [x] **Step 1: Write/update the failing tests**

In `test/viewer.test.ts`, assertions about the old single-line footer change to: the panel's last two rows are the statusline (badge + `L:C`) and the cmdline (hints); in visual-char mode the statusline contains `L:C-L:C`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `node --test test/viewer.test.ts`
Expected: FAIL (footer structure changed)

- [x] **Step 3: Wire it up**

- `CHROME_ROWS` 3 becomes 4.
- `render` drops the `FOOTER_HINTS[cardModeOf(...)]` assembly and instead calls:
  - `renderStatusLine({ mode: cardModeOf(mode), cursor: { line: cursor.line + 1, col: rawColToDisplayCol(raw, cursor.col) + 1 }, selection }, inner, colors)` - `selection` is provided only in visual modes, normalized (smaller position first), in display-space 1-based coordinates, with `kind` mapped from `visualMode`.
  - `renderCommandLine({ kind: "hints", mode: cardModeOf(mode) }, inner, colors)`.
  - `framePanel(rows, width, { title, footers: [statusline, cmdline], colors })`.
- Remove the `FOOTER_HINTS` import at the top of `viewer.ts`.

- [x] **Step 4: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS

- [x] **Step 5: Documentation wrap-up + commit**

Per AGENTS.md: check off all checkboxes in this plan, set front-matter `progress` to `6/6` and `status` to `done`; set spec `2026-10-18-statusline-and-hscroll-design.md` front-matter to `status: done`; move both entries in `STATUS.md` from Active to Done (following that file's existing format).

```bash
git add -A
git commit -m "feat(viewer): wire statusline/cmdline rows into annotate card"
```

---

## Amendment (post-merge, user decision after sandbox E2E)

The overflow indicators (left NF chevron / right `...`, Task 4) were removed: vim's default `listchars` enables neither `extends` nor `precedes`, and the indicator cells proved noisy in practice (visible on every short row once scrolled; cursor/indicator collisions at the follow edge). The cursor-wins-over-indicator splice went with them. What remains of Task 4: the display-column windowing itself, the render-time clamp, the wide-char strict slicing, the scroll-corrected comment-box anchor, plus an SGR reset appended when a span's closing code falls outside the sliced window. Orientation now relies on the statusline `L:C` readout.

## Self-check record

- Spec coverage: statusline (Tasks 5/6), cmdline (Tasks 5/6), horizontal-scroll state (Task 3), window rendering and indicators (Task 4), overlay anchor (Task 4), repeat fix (Task 2), CHROME_ROWS (Task 6) - full coverage.
- Type consistency: `ViewerViewport` (defined Task 3, used Tasks 3/4); `StatusLineInput`/`CommandLineInput` (defined Task 5, used Task 6); `rawColToDisplayCol` (relocated Task 1, used Tasks 3/4/6).
- Proportion: the plan is roughly 2x the spec; code blocks are test assertions and signatures only, no copied function bodies.
