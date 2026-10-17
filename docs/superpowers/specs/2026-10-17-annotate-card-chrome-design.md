# Annotate Card Chrome - Design

Status: approved
Date: 2026-10-17
Follow-up to: 2026-10-17-annotate-anything-mvp-design.md (done)

## Problem

The MVP card renders bare text lines into a pi-tui overlay. The overlay system composites text only; it does not paint a background, border, or title. As a result the card floats without visual containment: underlying editor content bleeds through, there is no border, no title, and no key-help footer. Manual e2e confirmed this is confusing.

pi's own overlay surfaces (e.g. the background-tasks manager) solve this by painting each row to full width with an ANSI background, drawing a box-drawing border, embedding a title in the top border, and printing a footer hint row. pi-tui ships a `Box` container that pads children and applies a background function, which confirms the pattern.

## Goals

1. The annotate card is a bordered panel: rounded box-drawing border (`╭ ╮ ╰ ╯ ─ │`), every row padded to the panel width. The background is transparent by design: pi-tui overlays repaint every cell they occupy, so nothing behind the card bleeds through and no theme bg token is needed.
2. The top border carries an embedded title: `╭─ Annotate: <relative-path> (N) ──...──╮` where N is the live count of pending annotations for the file (drafts whose pill still lives in the composer; pruned drafts stop counting immediately). N is omitted when 0. Long paths are truncated from the left to keep the file name visible.
3. A footer row inside the bottom of the panel shows mode-aware key hints, dimmed via the theme.
4. The comment input is a floating bordered sub-panel that opens adjacent to the current selection inside the card (below the selection's last visible row, flipping above it when space runs out; horizontally aligned to the selection start column, clamped to the panel width). It carries an embedded `Comment` title. The editor box is fixed-width (`min(innerWidth, 64)` columns; it never resizes while typing), soft-wraps its text at the box's inner content width, caps at 8 rows (6 content rows) with a scroll window that keeps the cursor's row visible, and emulates the text cursor with SGR inverse video (the character under the cursor is inverted; at end of line an inverse space). The cursor appears only in comment mode, never in the read-only preview.
5. Pending annotation styling: the range text is underlined with raw SGR 4 (theme-neutral) and the gutter marker (and nothing else) keeps the theme warning color. The marker is the Nerd Font comment icon U+F075 (`nf-fa-comment`) followed by the number of pending drafts covering the line (`+` above 9); lines without drafts render a blank field of the same width. Assuming a monospace Nerd Font (NF Mono), the icon is exactly 1 cell, so the marker field is a fixed 2 cells and line numbers never shift horizontally.
6. Pending annotations are editable in place. Key choices follow vim conventions: `c` is the change operator (in visual mode it comments the selection, unchanged; in normal mode with the cursor on a line covered by a pending annotation it reopens the floating comment box pre-filled with the existing comment and updates the draft in place on submit). `x` deletes the pending annotation under the cursor, mirroring vim's delete-char-under-cursor: the draft is removed and its pill token is stripped from the composer text. `d` is deliberately not used: it is an operator prefix in vim and would imply a pending-operator state machine.
7. Hover-style comment preview, toggleable. In normal mode, when the cursor rests on a line covered by a pending annotation, a read-only floating box (same chrome as the comment editor, `Comment` title) appears adjacent to the cursor line showing that annotation's comment. Moving off the line dismisses it. Pressing `c` turns the preview into the editor in place. Overlapping drafts: the most recently added one wins, matching the `c` and `x` targeting rule. Long comments are capped at 6 box rows. `p` toggles the preview on and off (normal mode); the toggle is card-session state, defaults to ON, and is deliberately NOT a persisted config option - pi's extension settings system is not unified yet. `p` has no vim meaning here (no paste/register concept in the card), so there is no habit conflict. The lookup is an O(pending-count) scan on the render path, which already runs per keystroke; no I/O, no re-highlight, no measurable cost.

## Non-goals

- Reopening the card via a keyboard shortcut (evaluated, dropped: the card already stays open, and slash-command reopening is a pi platform limitation, not worth working around).
- Mouse support, resize handling beyond re-render, markdown rendered view.

## Design

### Theme sources

- Foreground tokens from the pi theme: `border` (border glyphs), `dim` or `muted` (footer hints), `accent` (mode badges), `warning` (pending gutter marker), plus the existing syntax-highlight output.
- Background: none. The card is transparent by design - pi-tui overlays repaint every cell they occupy, so nothing behind the card can bleed through, and no theme bg token is looked up.

### Theme adaptivity

All colors come from the active pi theme through `theme.fg()` token lookups (`border`, `dim`/`muted`, `accent`, `warning`). No hardcoded ANSI colors anywhere in the chrome; border glyphs are neutral box-drawing characters. Raw SGR attributes (inverse for cursor/selection, underline SGR 4 for pending ranges) are deliberately theme-neutral. Theme plugins that restyle pi (e.g. custom themes installed by the user) therefore reskin the card automatically.

### Layout

```
╭─ Annotate: src/viewer.ts (2) ─────────────╮
│  10    func handler() {                   │
│  11 1  result := compute(ctx)            │   N = pending draft count (Nerd Font nf-fa-comment, U+F075; SGR 4 underline)
│  ...                                      │
│ hjkl move  v select  c comment  q close   │
╰───────────────────────────────────────────╯
```

Comment mode floats the sub-panel next to the selection:

```
│  10    func handler() {                   │
│  11 >  result := compute(ctx)             │   > = selection (2-cell marker field)
│        ╭─ Comment ─────────────────────╮  │
│        │ this is the comment text█     │  │   █ = inverse cursor
│        ╰───────────────────────────────╯  │
│  12    ...                                │
│ Enter submit  ctrl+j newline  Esc cancel  │
╰───────────────────────────────────────────╯
```

Placement rules: the box opens one row below the selection's last visible row; if fewer rows than the box height remain above the footer, it flips to one row above the selection's first visible row. Its left edge aligns with the selection's start display column, clamped so the box never crosses the panel's right border. Card content under the box is occluded: occluded rows are replaced in place, spliced ANSI-safely by display column (pi-tui `sliceByColumn` carries the SGR state into the surviving slivers, so styled text left and right of the box keeps its attributes).

The editor box is fixed at `min(innerWidth, 64)` columns; its text soft-wraps at the inner content width and the box caps at 8 rows (6 content rows), scrolling so the cursor's row stays visible. The text cursor is emulated with SGR inverse (character under the cursor inverted; inverse space at end of line). The read-only preview box stays content-sized and keeps its 6-row cap; it renders no cursor.

Footer content by mode, following vim's mode-indicator convention (every mode shows a badge in the theme `accent` color, followed by the mode's hints in `dim`):

- normal:  `-- NORMAL --  hjkl move  v/V select  c/x comment/delete  p preview  q/Esc close`
- visual (char): `-- VISUAL --  hjkl extend  o swap  c comment  Esc cancel`
- visual (line): `-- VISUAL LINE --  hjkl extend  o swap  c comment  Esc cancel`
- comment: `-- COMMENT --  Enter submit  ctrl+j newline  Esc cancel`

### Geometry

- The panel occupies the overlay width (unchanged: `width: "80%"`, `maxHeight: "80%"`, anchored center). All widths above are display columns; wide characters and tabs follow the existing helpers (`tabExpanded`, `rawColToDisplayCol`, `visibleWidth`, `truncateToWidth`).
- Two columns are consumed by the border; inner width = overlay width - 2. The viewport budget subtracts border (2) + footer (1). The floating comment box occludes content rows and does NOT consume viewport budget.
- Horizontal scrolling and cursor clamping are unchanged; they operate on inner width.

### Editing pending annotations

Pill tokens are a deterministic function of path + range, so editing a comment never invalidates the pill already sitting in the composer.

- `c` (normal mode, cursor position inside a pending annotation's range (column-precise: on a boundary line the cursor column must be within `[startCol, endCol]`; a no-op on lines/columns without pending annotations): enters comment mode anchored to that draft's range with the existing comment pre-filled. Submit calls a new `store.updateComment(draftId, comment)`; the range, snapshot text, and token are untouched. Esc cancels without changes. If the same position is covered by several overlapping drafts, the most recently added one is edited.
- `x` (normal mode, same column-precise targeting rule): removes the draft from the store and strips its pill token from the composer text (first occurrence). Removing the draft directly is safe because pruning is token-driven; the reverse direction (pill deleted in composer) already prunes via `pruneFromText`.
- The pending-count title and gutter markers reflect edits and deletions on the next render because the card's `pending` getter already re-reads the store.

### Input

- No other behavior change. The kitty-protocol Escape normalization shipped in `c51c0bd` stays the single normalization point at `handleInput` entry.

### Structure

- Rendering splits into pure helpers in `src/card-chrome.ts`: `framePanel(rows, width, { title, footer, colors })`, `frameCommentBox(lines, width, colors, title)`, `commentBoxPlacement(selTop, selBottom, selCol, boxH, boxW, innerW, viewH)`, and a column-precise `draftAtCursor(line, col, pending)` returning the most recent draft covering the cursor position (shared by preview, `c`, and `x`; boundary lines compare columns, inner lines hit anywhere). `FOOTER_HINTS` maps each card mode to a separately exported badge and hints string. All take color functions as parameters so they are unit-testable without a live theme. Comment text wrapping and the emulated cursor live in `src/comment-input.ts` as pure helpers (`wrapCommentLines(text, width, cursor) -> { lines, cursorRow, cursorCol }`, `withCursorCell(line, col)`).
- `AnnotateCard` receives the pi `Theme` from the `ctx.ui.custom` factory (already available there) and maps it to the color functions the helpers need.

## Acceptance

- Card shows border, embedded title with path and live pending count, and a mode-correct footer (badge in accent, hints in dim) in all four modes, including `-- NORMAL --`. Background is transparent by design (overlays repaint every cell).
- No bleed-through of underlying content at any card row.
- Comment input floats adjacent to the selection (below, flipping above near the bottom; left edge aligned to selection start, clamped to the panel), fixed-width with soft wrap, 8-row cap, and an emulated inverse cursor; Enter/Esc/ctrl+j behavior unchanged.
- Pending annotations still marked in the gutter with the warning-colored comment icon (U+F075 `nf-fa-comment`) plus the per-line draft count; the range text is underlined via raw SGR 4.
- `node --test test/` and `npx tsc --noEmit` stay green; new helper tests cover border geometry with wide characters and long-path truncation.
- Editing a comment updates the draft in place: token unchanged, composer pill untouched, snapshot unchanged. Deleting removes the draft and strips its pill from the composer.
- Normal-mode preview: cursor on a pending line shows the comment in a read-only floating box next to the line; moving away dismisses it; `c` converts the preview into the pre-filled editor.
- `p` toggles the preview off and on; with preview off, cursor on a pending line shows nothing until toggled back.
