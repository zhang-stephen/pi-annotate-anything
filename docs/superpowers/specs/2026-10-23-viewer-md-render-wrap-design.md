---
title: Viewer Markdown Rendering and Word Wrap - Design
status: approved
plan: ../plans/2026-10-27-viewer-md-render-wrap.md
---

# Viewer Markdown Rendering and Word Wrap - Design

Date: 2026-10-23

## Problem

The viewer renders raw file lines with no markdown awareness: long lines scroll horizontally (sliceWindow slices by display column), and `.md` files show plain text.
Users read files in the viewer precisely to circle ranges and annotate them, so the goal is a rendered reading experience without losing the extension's core promise: every visual selection maps back to exact raw file line/col ranges.
Two capabilities are needed, and they are coupled: CommonMark rendering (basic syntax, images excluded in phase 1) and word wrap (for rendered markdown and for plain long lines alike).

## Facts (verified in source and experiments)

- Selection and cursor state is stored in raw coordinates throughout (`src/core/selection.ts`: `line/col` count raw characters); display mapping happens only at render time via `rawColToDisplayCol` (tab expansion) in `src/tui/display.ts`.
- Styling is applied by `applyStyleSpans` (`src/viewer/line-style.ts`) over display-column spans; inverse (selection/cursor), match (hlsearch), target, and underline compose on top of emphasis styles.
- `keepVisible` (`src/viewer/movement.ts`) maintains both `scrollTop` (logical lines) and `scrollLeft` (display columns); scrollLeft is re-clamped every reduce.
- The viewer already has a pending two-stroke mechanism (`gg`); the `z` prefix is free; `p` is taken (hover preview toggle).
- pi-tui ships a full `Markdown` component (used by pi-markdown-preview) that reflows text (normalized list markers, rebuilt tables, hidden inline markers, wrapped paragraphs), so its output has no line/column correspondence to the source; it is unusable for annotation-preserving display.
- pi-tui re-exports `marked` (`Marked`), so structure recognition adds no new dependency.
- Experiment (2026-10-23): block-level marked tokens carry verbatim `raw` spanning whole source lines (blockquote, list, code, heading), giving exact line ranges and nesting; inline emphasis/codespan tokens carry verbatim `raw` including delimiters; link-class inline tokens do NOT always carry verbatim `raw` (a link reference definition inline produced `raw` that matches nothing at the cursor).

## Approach

Design principles, in priority order:

1. Raw coordinates are authoritative; nothing below ever changes stored state coordinates.
2. Rendering adds styling and a per-line fixed-width prefix only; inline text is never transformed, so inline display columns equal tab-expanded raw columns plus the line's prefix offset.
3. Every mapping is a pure function; when a mapping input cannot be verified, styling degrades to plain text -- failure is cosmetic, never positional.

### Rendering model (keep markers, color content; add block chrome)

- Inline (markers stay visible, dimmed; content styled): `**bold**`, `*em*`, `~~strike~~`, `` `code` ``; links `[text](url)` get underlined text and dimmed URL part; escapes `\*` get a dimmed backslash; entities and raw HTML are left as plain text.
- Block: heading markers dim, content bold + accent; ATX and setext headings both recognized; quote lines get a `▎ ` prefix (prefixWidth 2, the glyph is a UI string literal); fenced code lines (fence rows dim) and indented code block lines get a background color and no inline styling inside; thematic breaks are styled as a rule; list markers get accent color; list continuation lines get a hanging indent derived from marker width; nested structures compose (quote inside list, list inside quote) via the structure stack, prefix arithmetic is additive.
- Link reference definitions (rendered invisible by CommonMark) stay visible, wholly dimmed, signaling "not content".
- Images: `![alt](url)` syntax stays visible and dimmed in phase 1; rendering actual images is phase 2 (below).
- Tables and LaTeX stay unstyled raw text (they are GFM/extension syntax, outside CommonMark).

### Recognition layer: marked lexer + verbatim-verify fallback

- Block structure comes from `new Marked().lexer(text)`: walk tokens, locate each block token's verbatim `raw` at line boundaries, derive per-line structure (quote depth, list nesting, code-interior, heading kind) and per-line prefixWidth + line styles.
- Inline spans come from inline tokens matched with a forward-only cursor within each block's raw: a span is accepted only if its `raw` matches the source verbatim at the cursor; on mismatch the span is dropped (plain text).
- This makes marked's non-verbatim token shapes (links) a styling risk only; emphasis and codespan are verbatim in practice and pass verification.
- The scanner is a pure module (input: file lines; output: per-line styles + prefixWidth + inline spans in raw columns), unit-testable without a TUI.

### Word wrap engine

- New pure module `src/viewer/wrap.ts`: splits a logical line (tab-expanded, prefix attached) into visual segments for a given content width.
- Word wrap: break at spaces and punctuation for Latin runs; break anywhere inside CJK runs; continuation segments repeat the line's block prefix (quote bar etc.).
- Hard break as last resort: an unbreakable token longer than the content width breaks at exact width; wide characters never straddle a break (reuse the width-aware slicing rules of sliceWindow).
- Segment records carry (logical line, raw column start) so cursor positioning and selection painting map visual rows to raw coordinates by arithmetic, not search.

### Keymap adaptation

| Key | wrap ON | wrap OFF (status quo) |
|---|---|---|
| j/k | move by visual row | move by logical line |
| h/l | plain cursor move; horizontal scroll disabled (scrollLeft pinned 0); crossing a segment end moves to the next segment | cursor move + horizontal scroll |
| 0/$/^ | logical line start/end/first-non-blank (unchanged) | same |
| gg/G/ctrl-d/ctrl-u | scroll and jump in visual rows | logical lines |
| zw | toggle wrap | same |
| zr | toggle markdown rendering; no-op for non-md files | same |

- Both default ON (hardcoded session state like `previewOn`); moving the defaults into the settings system is deferred to the settings specs (deliberate scope cut).
- Wrap OFF preserves today's behavior bit-for-bit (equivalence is a test goal).
- The pending-g leftovers noted in STATUS.md are unaffected: no g-family keys are added; wrap ON changes j/k semantics directly, vim's gj/gk distinction is intentionally not adopted (user preference: hjkl does what is visually natural).

### Annotation precision

- `src/core/selection.ts` and all stored state remain untouched.
- Display column arithmetic gains exactly one term: `displayCol = rawDisplayCol + prefixWidth` for selection/cursor/hlsearch painting; hlsearch matches are computed on raw text (unchanged) and painted through the same path, so no divergence is possible.
- Selections spanning wrapped segments are painted per visual segment (intersect range with each segment's raw-column window); extraction reads raw text and is unaffected.
- Comment payloads never render markdown (unchanged; user call 2026-10-23).

## Phase 2 (design sketch, not scheduled): optional image support

- Gate: terminal image protocol detected (kitty graphics / iTerm2 inline / sixel) AND a user setting enabled; both required.
- Rendering places the image on its own visual rows below the syntax row; the `![alt](url)` syntax row itself stays visible and dimmed, so the anchor and raw mapping survive; local paths first, remote URLs later.
- Re-draw placement cost (images must be re-anchored after each card redraw) is the main unknown; that is why this is a separate phase.

## Module layout (refactor landing zones)

- `src/tui/display.ts`: gains `DisplayLine` type and `buildDisplayLine()` (pure; raw line + scan result to display text, prefixWidth, spans), stays a leaf module.
- `src/viewer/markdown.ts` (new): marked-based scanner, pure.
- `src/viewer/wrap.ts` (new): wrap engine + visual-row viewport helpers, pure.
- `src/viewer/state.ts`: `keepVisible` splits into vertical (visual rows) and horizontal (nowrap only); new session flags `wrapOn`/`renderOn`.
- `src/viewer/viewer.ts`: render loop iterates visual rows when wrap is on; block prefix + span painting via existing applyStyleSpans.
- `src/tui/card-chrome.ts`: unchanged.

## Testing

- Unit (wrap): CJK break points; wide char exactly at the boundary; unbreakable long token hard break; continuation segments carry prefix; segment raw-column arithmetic round-trips.
- Unit (scanner): golden files for each block kind incl. nesting; inline verbatim-verify fallback (feed a link-class token whose raw mismatches; expect plain text, no throw); prefixWidth composition for nested quote+list.
- Unit (equivalence): wrap OFF render output identical to today's (snapshot of current behavior); all existing reducer tests unchanged and green.
- Unit (mapping): selection painting across segments vs raw ranges; hlsearch columns through the +prefixWidth path.
- `npm test` and `npx tsc --noEmit` green.
- Manual E2E (real terminal, per AGENTS.md): window resize re-wrap; zw/zr toggling live; zr on non-md file is a no-op; wide char at wrap boundary; kitty key repeat on j/k in wrap mode.

## Out of scope (phase 1)

- Settings integration for the two defaults (follows the settings specs).
- Tables, LaTeX, fence-internal syntax highlighting (highlightCode-style hooks later).
- g-family screen-line motions; comment markdown rendering.
- Image rendering (phase 2).

## Supplementary requirement (2026-10-27): current-pill restyle

The existing inline composer pill changes from `[src/a.ts:10-20]` to `[<glyph> <basename><range>]`, for example `[<glyph> a.ts:10-20]`.
The glyph is the existing NF comment glyph used for pending annotations in the viewer, and the range keeps its leading colon and existing line or character forms.
This is a display-label change within the current token-era composer, not a tray, status-line, type-tag, or submission-order redesign.

- `tokenLabel()` uses the draft basename while `displayPath()` and `formatPayload()` remain unchanged, so payload paths stay cwd-relative inside the cwd and absolute outside it.
- Existing `~N` collision suffixes remain part of the token when needed, for example `[<glyph> a.ts:10-20~2]`.
- Token matching, inverse-video recoloring, `alt+o`, comment editing, and payload expansion retain their current behavior.
- Unit tests cover line and character ranges, same-basename collisions, NF-bearing token matching and recoloring, and unchanged payload output.
- Manual E2E in a real terminal covers glyph width, cursor alignment, and composer wrapping; the existing wrapped-token recolor limitation must not be described as fixed unless separately implemented and verified.

## Post-merge correction (2026-10-27): first-non-blank motion

~~The keymap describes `^` as unchanged.~~ Source inspection during planning found no `^` arm in `src/viewer/state.ts`.
The phase-1 implementation adds `^` as logical first-non-blank in both wrap modes; wrap-OFF equivalence applies to pre-existing motions, not this newly specified addition.

## Supplementary requirement (2026-10-27): comment insertion caret

This requirement changes the caret-cell decision implemented by [Comment Input Cursor Movement - Design](2026-10-22-comment-cursor-design.md) and [its plan](../plans/2026-10-22-comment-cursor.md); both remain done and unchanged.
The current implementation paints the grapheme to the left of the caret's insertion offset, so end-of-text paints the last typed character.
The required behavior is an insertion caret: paint the grapheme at the insertion column, or a blank cell after the text when the offset is at row end.

- Keep text insertion and deletion semantics unchanged, and keep caret offsets as raw code-unit insertion boundaries.
- A shared soft-wrap boundary belongs to the following visual row; hard-line and absolute text-end carets use the row-end blank cell.
- Home, End, Up, Down, Left, and Right use the same insertion-point mapping, including one-press transitions across soft wraps.
- A row-end blank may occupy the right `PAD_X` padding cell; framing must preserve exact row width and must never truncate the caret marker or emit an ellipsis for that cell.
- Preserve grapheme-cluster safety and the existing hardware/fake cursor marker contract without reading cursor settings in the extension.
- Unit tests cover empty, middle, end, wide-grapheme, hard-newline, and full-wrap-row positions; real-terminal E2E covers both hardware-cursor settings and arrow-key movement.
