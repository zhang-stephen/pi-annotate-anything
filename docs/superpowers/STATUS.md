# Project Status

Read this file first at the start of a session.
It is only an index: the
authoritative status of each spec/plan lives in its own YAML front-matter
(`status: draft|approved|in-progress|done`, plans also carry `progress: n/m`).
Do not open docs marked `done` unless the current work touches that area.

## Active

- spec: `docs/superpowers/specs/2026-10-22-user-settings-design.md`
  - approved (user call 2026-10-22), implementation not started
- spec: `docs/superpowers/specs/2026-10-22-settings-evolution-design.md`
  - draft, awaiting design review (spun out of user-settings 2026-10-22)
- spec: `docs/superpowers/specs/2026-10-22-comment-cursor-design.md`
  - draft, review deferred (kept in the index because docs.test.ts requires it; user call 2026-10-22)
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

- 2026-10-19: annotate path-completion manual E2E still owed on master (plan `2026-10-18-annotate-path-completion.md` Task 2 Step 3, merge proceeded on review evidence per user direction).
  Cover: Tab completion, directory drill-down, empty-result fallback, and the resume-cwd case (launch pi in directory B, resume a session stored with cwd A, verify relative-path completion and the handler agree - the scenario fix `e0e0067` targets).
  The resume-cwd case is rare and not reproducible in the current environment, so it stays a deferred manual check.
- 2026-10-22: transcript scroll above sent annotation payloads (needs repro): after a message with annotations is submitted, Up does not scroll the transcript back to messages above the injected comment blocks.
  Facts: the submitted message is expanded by core/transform.ts into quote blocks (header + fence + snapshot + Comment line); the transcript itself and all its scrolling are pi-host UI the extension does not own.
  Candidate causes to distinguish in repro: Up navigating composer input history while the editor holds focus (never reaching transcript scroll), versus a pi transcript scroll clamp that stops short of older messages; only the second could involve the injected payload's height measurement.
  If host-side, the fix is upstream pi; if the payload format trips the scroller, the fix lands in message.ts/transform.ts.
- 2026-10-22: pill restyle (one per line, basename, type tag): requested composer-pill changes -- each pill renders as its own line, the path shows basename-only, and a comment-type tag joins the pill.
  Agreed direction (user call 2026-10-22): the type vocabulary is a small closed set -- note (default) / question / todo -- set by a prefix in the comment box (? or todo:) or a cycling keybind (input mechanism still open); the tag renders short in the pill ([? src/a.ts:10]) and in the payload header (Comment (question): ...), and Draft gains a kind field to carry it.
  Basename-only display accepted (user call 2026-10-22): the payload keeps the full path, so the LLM context is unaffected; same-basename collisions stay rare and store.ts already disambiguates identical tokens with ~N suffixes, so no key-vs-display token split is needed for v1.
  Facts: pills are literal buffer tokens (tokenLabel in core/message.ts, e.g. [src/a.ts:10-20]) recolored inverse-video by withTokenRecolor (tui/editor.ts). The MVP spec never froze the format -- the freeze wording lives only in the message.ts header comment describing MVP-time cross-module sync; format evolution is normal feature evolution via a new spec, not an MVP amendment (user call 2026-10-22), and the implementing change rewords that comment.
  One-pill-per-line may later move pills out of the buffer into a dedicated attachment tray; path style (basename/relative/absolute) is a natural settings key once the user-settings spec lands.

## Done

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
