# Annotate Card Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-zh's subagent-driven-development or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: docs/superpowers/specs/2026-10-17-annotate-card-chrome-design.md (approved)
Branch: feat/card-chrome off master. TDD: failing test first, then implementation, then refactor.

## Task 1: src/card-chrome.ts - pure rendering helpers

- [x] **Step 1: failing tests** for `framePanel(rows, width, opts)` where opts = { title, footer, colors }; assert: rounded border rows, title embedded in the top border (`╭─ <title> ─...─╮`) with left-truncation of long titles, every row padded to full width and passed through colors.bg, footer as last inner row, wide-char titles/footers handled by display width.
- [x] **Step 2: failing tests** for `frameCommentBox(lines, width, colors, title)`: bordered box with embedded title, inner lines padded to width, colors.bg on every row, long lines truncated by display width.
- [x] **Step 3: failing tests** for `commentBoxPlacement(selTop, selBottom, selCol, boxH, boxW, innerW, viewH)`: below-selection default, flip above when boxH does not fit above the footer, left edge aligned to selCol clamped to [0, innerW - boxW], never overlaps border columns.
- [x] **Step 4: failing tests** for `draftAtCursor(cursorLine, pending)`: returns the last (most recent) draft whose range covers cursorLine, undefined otherwise; char-wise and line-wise ranges both covered.
- [x] **Step 5: failing tests** for FOOTER_HINTS: normal has no mode badge; visualChar -> `-- VISUAL --`; visualLine -> `-- VISUAL LINE --`; comment -> `-- COMMENT --`; normal hints mention c/x/p/q; keys match the spec tables exactly.
- [x] **Step 6: implement** src/card-chrome.ts to green. Colors injected as a { bg, border, dim, accent, warning } record of (text) => string functions; helpers never import theme modules.
- [x] **Step 7: verify** `node --test test/` green, `npx tsc --noEmit` clean.

## Task 2: viewer.ts chrome integration

- [x] **Step 1: failing tests** (via the existing viewer render seams) for: rendered output row 0 is the top border with embedded title `Annotate: <relative path>` plus ` (N)` when N > 0; last row is the bottom border; footer row present above it; every row has uniform display width.
- [x] **Step 2: implement** AnnotateCard theme plumbing: constructor receives the pi Theme (passed from the ctx.ui.custom factory in index.ts); build the color record via theme.fg/theme.bg (`border`, `dim`, `accent`, `warning`, bg token `customMessageBg`).
- [x] **Step 3: implement** render() through framePanel: border rows, title with live pending count from the pending() getter, footer hint from FOOTER_HINTS by state.mode (+ badge in accent, hints in dim), all rows bg-filled.
- [x] **Step 4: geometry update** - inner width = width - 2; viewport budget subtracts border (2) + footer (1) instead of RESERVED_ROWS; cursor clamping and horizontal scroll operate on inner width; update affected viewer tests.
- [x] **Step 5: floating comment box** - in comment mode, render frameCommentBox output over the content rows at commentBoxPlacement(selTop, selBottom, selStartCol, boxHeight, boxWidth, innerWidth, viewportRows); occluded rows are replaced, not pushed down.
- [x] **Step 6: pending styling** - gutter `*` and underline spans take theme `warning` color instead of raw ANSI.
- [x] **Step 7: verify** full suite + tsc.

## Task 3: comment edit + delete (reducer, store, wiring)

- [x] **Step 1: failing store tests** for `updateComment(id, comment)`: comment replaced, token/range/snapshot untouched, unknown id is a no-op (document the contract).
- [x] **Step 2: failing reducer tests**: normal `c` on a pending line enters comment mode with state.editingDraftId set and the comment box pre-filled with the draft's comment; `c` on a non-pending line is a no-op; `x` on a pending line yields effect { type: "delete", draftId }; `x` elsewhere is a no-op; submit in editing mode yields { type: "update", draftId, comment } instead of annotate; Esc in editing mode cancels without changes.
- [x] **Step 3: implement** store.updateComment in store.ts and reducer changes in viewer-state.ts to green.
- [x] **Step 4: implement** index.ts wiring: effect "update" -> store.updateComment (no pill paste, short confirmation notify); effect "delete" -> store remove + strip the draft's pill token (first occurrence) from the composer via getEditorText/setEditorText.
- [x] **Step 5: verify** full suite + tsc.

## Task 4: hover preview + p toggle

- [x] **Step 1: failing reducer tests**: normal mode `p` toggles state.previewOn (default true); toggle state survives mode changes within the card session.
- [x] **Step 2: failing viewer tests**: normal mode + previewOn + draftAtCursor hit -> rendered output contains a read-only frameCommentBox (title `Comment`) placed by commentBoxPlacement anchored to the cursor line; preview off -> absent; cursor off pending lines -> absent; comment longer than 6 box rows -> capped.
- [x] **Step 3: implement** the preview rendering in viewer.ts to green (reuses Task 1/2 seams only; no new input handling beyond `p`).
- [x] **Step 4: verify** full suite + tsc.

## Task 5: docs and e2e

- [x] **Step 1: update README** key tables (c/x/p, mode badges, floating comment box, preview) - keep it accurate, no marketing.
- [x] **Step 2: manual e2e** (user, real TUI) - detailed scenario list below.
- [x] **Step 3: update STATUS.md** and merge feat/card-chrome to master after e2e passes (merge needs explicit user approval).

### E2E scenarios (run from the repo root, fixtures under .superpowers/sdd/2026-10-17-annotate-anything-mvp/e2e-fixtures/)

1. **Panel chrome**: `/annotate` the ascii.ts fixture -> card shows a rounded border, an embedded title `Annotate: ...ascii.ts`, and no underlying content bleeding through any row (scroll the card over a busy chat area to check).
2. **Theme adaptivity**: with the user's active theme (zentui), border/bg/dim/accent/warning colors follow the theme; switch pi theme, reopen the card, confirm recolor with zero code changes.
3. **Footer and mode badges**: normal mode shows hints with no badge; `v` shows `-- VISUAL --`; `V` shows `-- VISUAL LINE --`; `c` shows `-- COMMENT --`; Esc walks back through the modes and the badge follows.
4. **Title pending count**: submit two annotations without closing the card -> title shows `(2)`; close the card, delete one pill in the composer, reopen the same file -> title shows `(1)`.
5. **Floating comment box placement**: (a) select a range near the top of wide.go -> box opens below the selection; (b) select a range on the last visible lines -> box flips above the selection; (c) start a char-wise selection far to the right -> box is clamped inside the right border; (d) type a long multi-line comment -> box grows downward/upward within the panel and never overlaps the border or footer.
6. **Hover preview**: with two annotations on wide.go, move the cursor onto a pending line in normal mode -> a read-only `Comment` box appears next to the line; move off -> it disappears; where ranges overlap, the most recent annotation's comment shows; a comment longer than 6 rows is capped; press `p` -> preview stops appearing; press `p` again -> it returns.
7. **Edit in place**: cursor on a pending line, `c` -> the box opens pre-filled with the existing comment; edit and Enter -> no new pill appears in the composer; send -> the payload carries the updated comment under the unchanged token label; repeat and Esc -> the original comment is unchanged.
8. **Delete**: cursor on a pending line, `x` -> the gutter `*` and underline disappear immediately and the matching pill is removed from the composer; send -> the payload excludes that annotation.
9. **Regression sweep**: Esc exits visual and comment modes and closes the card from normal mode (kitty terminals); tab-indented lines in wide.go stay aligned with their line numbers; a char-wise `v` + `c` with no movement selects exactly the character under the cursor and the label/snapshot agree; sending with a pill deleted from the composer drops that annotation (existing prune behavior).
