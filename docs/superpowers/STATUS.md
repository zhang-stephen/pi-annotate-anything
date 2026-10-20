# Project Status

Read this file first at the start of a session.
It is only an index: the
authoritative status of each spec/plan lives in its own YAML front-matter
(`status: draft|approved|in-progress|done`, plans also carry `progress: n/m`).
Do not open docs marked `done` unless the current work touches that area.

## Active

- plan: `docs/superpowers/plans/2026-10-20-fuzzy-completion-search-parity.md`
- spec: `docs/superpowers/specs/2026-10-20-fuzzy-completion-search-parity-design.md`
- spec: `docs/superpowers/specs/2026-10-17-ci-tui-e2e-design.md`
  - draft, on hold: low priority, do not schedule (user call 2026-10-20)

## Known issues (deferred, no spec yet)

- 2026-10-18: annotate card loses keyboard focus while the main agent is active; keys fall through to the underlying main UI.
  Host facts verified from source: pi-tui routes all input to a single `focusedComponent`; `showOverlay` captures focus on open; no agent-event handler calls `setFocus`; `hideOverlay` fires only on fullscreen exit / session invalidate / `/reload`.
  Prime suspect: the host's blocked-then-restore overlay focus machinery (pi-tui `setFocusInternal`) races when a mid-run dialog (e.g. tool confirmation) yields focus back to the editor instead of the overlay.
  Fix direction: grab the `OverlayHandle` via `ctx.ui.custom`'s `onHandle` and re-assert `handle.focus()` on agent lifecycle events while the card is open; optionally file an upstream pi issue.
  Deferred: the scenario (agent active + card open) is rare in practice.

- 2026-10-19: annotate path-completion manual E2E still owed on master (plan `2026-10-18-annotate-path-completion.md` Task 2 Step 3, merge proceeded on review evidence per user direction).
  Cover: Tab completion, directory drill-down, empty-result fallback, and the resume-cwd case (launch pi in directory B, resume a session stored with cwd A, verify relative-path completion and the handler agree - the scenario fix `e0e0067` targets).
  The resume-cwd case is rare and not reproducible in the current environment, so it stays a deferred manual check.

- 2026-10-20: fuzzy path completion for /annotate (deferred feature, decided, no spec yet).
  Decisions: hybrid scope C (no slash in the argument -> workspace-wide fuzzy over relative paths; contains slash -> fuzzy within that directory; empty prefix -> keep current directory browsing); reuse pi-tui `fuzzyMatch`/`fuzzyFilter` instead of a self-written matcher (implies declaring a minimum host version that exports them - verify the introducing pi version at spec time); enumeration fallback chain `git ls-files` -> `fd` -> bounded walk, per-session cache with short TTL.
  Blocked on: src-module-layout plan merge (both touch `path-completion.ts`; the feature is the new layout's first consumer).

- 2026-10-19: viewer search vim-parity backlog (deferred review minors, no spec yet): arrow keys do not consume a pending count (vim parity; current behavior keeps the brief's consumer list), a digit key during a pending `g` arms the count instead of canceling the two-stroke, findMatches hardening for non-global regexes and jumpTarget count <= 0 (both outside the current contract).

## Done

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
