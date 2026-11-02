# Project Status

Read this file first at the start of a session.
It is only an index: the
authoritative status of each spec/plan lives in its own YAML front-matter
(`status: draft|approved|in-progress|done`, plans also carry `progress: n/m`).
Do not open docs marked `done` unless the current work touches that area.

## Active

- spec: `docs/superpowers/specs/2026-10-23-viewer-md-render-wrap-design.md`
  - in-progress (user review 2026-10-27); phase 1 = wrap + CommonMark (no images) rendering + keymap adaptation + the 2026-10-27 current-pill restyle and comment-caret supplements, phase 2 = optional protocol-gated image support (sketch only); Tasks 1-7 locally committed and reviewed, Task 8 next
- plan: `docs/superpowers/plans/2026-10-27-viewer-md-render-wrap.md`
  - in-progress 7/9; Tasks 1-7 locally committed and reviewer-approved; Task 8 annotation/overlay mapping plus two reviewed geometry follow-ups next; three releases planned after one shared E2E pass
- spec: `docs/superpowers/specs/2026-10-22-user-settings-design.md`
  - approved (user call 2026-10-22), implementation not started; rides a later train, not 2.0
- spec: `docs/superpowers/specs/2026-10-22-settings-evolution-design.md`
  - draft, awaiting design review (spun out of user-settings 2026-10-22)
- spec: `docs/superpowers/specs/2026-10-17-ci-tui-e2e-design.md`
  - draft, on hold: low priority, do not schedule (user call 2026-10-20)

## Known issues (deferred, no spec yet)

- 2026-10-20: path-completion symlinked dirPart: the ready-index subtree match is lexical, so a symlinked directory part (linkdir/ -> sub/) matches nothing in the index while the degraded path lists through the symlink; candidate fix: treat "no entry carries the prefix at all" as a fall-through to the live directory listing. Also absorbs the case-mismatched dirPart edge on case-insensitive filesystems.

- 2026-10-22: annotation payload mini-prompt (low priority, deferred, not scheduled): a fallback aid for weaker models only -- current models parse the payload (file, range, snapshot, labeled comment) and read surrounding context unprompted, so no per-message hint line ships now; if ever needed, append ONE permission-style HTML-comment line per message after token expansion in transform.ts; amends the payload contract in specs/2026-10-17-annotate-anything-mvp-design.md (line ~73); not per-annotation, not imperative.
- 2026-10-20: viewer pending-g leftovers (future): if screen-line motions (the g0/gj/gk family) are ever added, the pending-g digit swallow needs a carve-out for `0`; the `g` keypress itself already clears any armed count, so no count survives the swallow. Related fidelity gap surfaced 2026-10-22 during showcmd acceptance: `gg` does not consume an armed count (vim's `3gg` goes to line 3, ours jumps like plain `gg` because clearUnusedCount drops the count when `g` arms), so showcmd shows `g` after `3` then `g`, never `3g`; fixing this belongs with the g-family work.
- 2026-10-18: annotate card loses keyboard focus while the main agent is active; keys fall through to the underlying main UI.
  Host facts verified from source: pi-tui routes all input to a single `focusedComponent`; `showOverlay` captures focus on open; no agent-event handler calls `setFocus`; `hideOverlay` fires only on fullscreen exit / session invalidate / `/reload`.
  Prime suspect: the host's blocked-then-restore overlay focus machinery (pi-tui `setFocusInternal`) races when a mid-run dialog (e.g. tool confirmation) yields focus back to the editor instead of the overlay.
  Fix direction: grab the `OverlayHandle` via `ctx.ui.custom`'s `onHandle` and re-assert `handle.focus()` on agent lifecycle events while the card is open; optionally file an upstream pi issue.
  Deferred: the scenario (agent active + card open) is rare in practice.

- 2026-10-22: composer tray and annotation kinds (future major, no spec yet): explore store-backed attachments rendered one row per mark above the composer, a closed note/question/todo kind vocabulary, and prompt-first submission with payloads appended in draft order and token parsing retired.
  Empty prompt with attachments still submits; `alt+backspace` removes the last row and `/annotate` provides fine-grained management; open decisions are tray height cap and kind input.
  The approved token-era pill label restyle is tracked separately in the viewer Markdown/wrap spec.

## Done

- spec: `docs/superpowers/specs/2026-10-22-comment-cursor-design.md`
- plan: `docs/superpowers/plans/2026-10-22-comment-cursor.md`
- spec: `docs/superpowers/specs/2026-10-23-composer-jump-back-design.md`
- plan: `docs/superpowers/plans/2026-10-23-composer-jump-back.md`
- plan: `docs/superpowers/plans/2026-10-23-q-only-close.md`
- spec: `docs/superpowers/specs/2026-10-22-editor-single-install-design.md`
- plan: `docs/superpowers/plans/2026-10-22-editor-single-install-plan.md`
- spec: `docs/superpowers/specs/2026-10-22-viewer-command-line-design.md`
- plan: `docs/superpowers/plans/2026-10-22-viewer-command-line.md`
- plan: `docs/superpowers/plans/2026-10-22-vim-behavior-alignment.md`
- plan: `docs/superpowers/plans/2026-10-20-fuzzy-completion-search-parity.md`
- spec: `docs/superpowers/specs/2026-10-20-fuzzy-completion-search-parity-design.md`
- plan: `docs/superpowers/plans/2026-10-20-src-module-layout.md`
- spec: `docs/superpowers/specs/2026-10-20-src-module-layout-design.md`
- plan: `docs/superpowers/plans/2026-10-19-viewer-search.md`
- spec: `docs/superpowers/specs/2026-10-18-viewer-search-design.md`
- plan: `docs/superpowers/plans/2026-10-18-annotate-path-completion.md`
- spec: `docs/superpowers/specs/2026-10-18-annotate-path-completion-design.md`
- plan: `docs/superpowers/plans/2026-10-18-statusline-and-hscroll.md`
- spec: `docs/superpowers/specs/2026-10-18-statusline-and-hscroll-design.md`
- plan: `docs/superpowers/plans/2026-10-18-composer-coexistence.md`
- plan: `docs/superpowers/plans/2026-10-18-annotate-stacked-and-gutter.md`
- plan: `docs/superpowers/plans/2026-10-17-annotate-card-chrome.md`
- spec: `docs/superpowers/specs/2026-10-18-annotate-stacked-and-gutter-design.md`
- plan: `docs/superpowers/plans/2026-10-17-annotate-anything-mvp.md`
- spec: `docs/superpowers/specs/2026-10-17-annotate-card-chrome-design.md`
- spec: `docs/superpowers/specs/2026-10-17-annotate-anything-mvp-design.md`
