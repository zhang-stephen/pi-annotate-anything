---
title: Viewer Markdown Rendering and Word Wrap - Design
status: draft
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
