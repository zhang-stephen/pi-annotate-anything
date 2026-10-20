# src/ Module Map

This directory is layered; the dependency direction is one-way: `core <- tui <- viewer <- index.ts`.

## Layers

- `core/` -- pure logic, no host imports (`@earendil-works/*`): selection, file-range, search, store, message, transform.
- `tui/` -- reusable TUI widgets, may import host packages and `core/`: card-chrome, display, comment-input, editor, path-completion.
- `viewer/` -- the annotation viewer feature, may import `core/` and `tui/`: viewer (AnnotateCard shell), state (reducer), movement, search-mode, comment-mode, layout, line-style, status-line.
- `index.ts` (repo root) -- the composition root; the only module that wires layers together.

## Rules

- New pure logic (no TUI) goes to `core/`.
- New reusable widget goes to `tui/`.
- New viewer behavior goes to `viewer/`; mode transitions live in the matching mode module, not in `viewer.ts`.
- Never import upward against the layer direction; `test/architecture.test.ts` enforces this.
- Tests mirror the layout under `test/` (`test/core/`, `test/tui/`, `test/viewer/`).
