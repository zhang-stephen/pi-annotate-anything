# Project Status

Read this file first at the start of a session.
It is only an index: the
authoritative status of each spec/plan lives in its own YAML front-matter
(`status: draft|approved|in-progress|done`, plans also carry `progress: n/m`).
Do not open docs marked `done` unless the current work touches that area.

## Active

- spec: `docs/superpowers/specs/2026-10-23-viewer-md-render-wrap-design.md`
  - draft, awaiting design review; phase 1 = wrap + CommonMark (no images) rendering + keymap adaptation, phase 2 = optional protocol-gated image support (sketch only)
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

- 2026-10-19: annotate path-completion manual E2E still owed on master (plan `2026-10-18-annotate-path-completion.md` Task 2 Step 3, merge proceeded on review evidence per user direction).
  Cover: Tab completion, directory drill-down, empty-result fallback, and the resume-cwd case (launch pi in directory B, resume a session stored with cwd A, verify relative-path completion and the handler agree - the scenario fix `e0e0067` targets).
  The resume-cwd case is rare and not reproducible in the current environment, so it stays a deferred manual check.
- 2026-10-22: composer Up history browsing breaks around annotation submits (root cause verified in pi 1.3.0 source): after a comments-bearing submit, Up cannot browse past the annotation entries.
  Verified facts: history entries store the pre-transform compact token text (interactive-mode.js calls editor.addToHistory synchronously with the submitted editor text, before extension input transforms run), so entry size is not the cause; pi-tui Editor's navigateHistory/cursorUp dispatch has no trap; but setCustomEditorComponent swaps editor instances copying text, callbacks, appearance, and action handlers -- never history -- and Editor.history is private (addToHistory is the only public surface), so extensions cannot shuttle history across swaps.
  Mechanism: the extension installs its token-recolor editor when a card opens with pills and restores the previous factory when idle (card close without pending pills, message_start after submit); submits during an annotation session land in the extension instance's history, which is discarded on restore, so live history browsing stops exactly at the annotation-session boundary.
  Fix directions: extension-side (preferred) -- install the recolor wrapper once per session and never re-swap (the chained factory keeps the user's configured editor underneath; recolor is a passthrough when no tokens are live), eliminating instance churn entirely; upstream -- pi should carry history across editor swaps or expose getHistory/setHistory. Upstream feature request filed 2026-10-22 as earendil-works/pi#11285 (prior reports #8798/#5466 were auto-closed without action). FIXED in master via the editor-single-install spec (fix 66a3683): the extension no longer swaps editors, so its own history loss is gone; the host-side carry-over gap stays open upstream.
- 2026-10-22: pill restyle (one per line, basename, type tag): requested composer-pill changes -- each pill renders as its own line, the path shows basename-only, and a comment-type tag joins the pill.
  Agreed direction (user call 2026-10-22): the type vocabulary is a small closed set -- note (default) / question / todo -- set by a prefix in the comment box (? or todo:) or a cycling keybind (input mechanism still open); the tag renders short in the pill ([? src/a.ts:10]) and in the payload header (Comment (question): ...), and Draft gains a kind field to carry it.
  Basename-only display accepted (user call 2026-10-22): the payload keeps the full path, so the LLM context is unaffected; same-basename collisions stay rare and store.ts already disambiguates identical tokens with ~N suffixes, so no key-vs-display token split is needed for v1.
  Facts: pills are literal buffer tokens (tokenLabel in core/message.ts, e.g. [src/a.ts:10-20]) recolored inverse-video by withTokenRecolor (tui/editor.ts). The MVP spec never froze the format -- the freeze wording lives only in the message.ts header comment describing MVP-time cross-module sync; format evolution is normal feature evolution via a new spec, not an MVP amendment (user call 2026-10-22), and the implementing change rewords that comment.
  Tray direction recorded (user call 2026-10-22): pills become store-backed attachments rendered one row per pill above the composer input line (the permanent editor wrapper renders tray rows + inner editor, height grows accordingly); a row shows kind tag + basename + range + truncated comment; submit = prose + payload blocks appended in draft order, and the token parsing layer (tokenLabel/expandTokens) retires; v1 editing keys: alt+backspace removes the last pill, fine-grained management stays in /annotate; empty prose with pills present still submits; open: tray height cap and kind-switch keys. Jump-back (alt+o, specs/2026-10-23-composer-jump-back-design.md; `:e` deferred) ships on 2.0 in the token era; the tray itself and its payload format break move to a later major. Path style (basename/relative/absolute) is a natural settings key once the user-settings spec lands.

## Done

- spec: `docs/superpowers/specs/2026-10-22-comment-cursor-design.md`
- plan: `docs/superpowers/plans/2026-10-22-comment-cursor.md`
  - done 2026-10-23 on the 2.0 train: caret model + movement keys (b3e0c1c), hardware cursor incl. cmdline/search (ced4475, bd73a4f), wrap-width render fix (20acb09), one-press soft-wrap transitions (46bb671); user E2E passed (arrows under kitty and legacy protocols, mid-text edits, cursor visibility and fallback)
- spec: `docs/superpowers/specs/2026-10-23-composer-jump-back-design.md`
- plan: `docs/superpowers/plans/2026-10-23-composer-jump-back.md`
  - done 2026-10-23 on the 2.0 train: alt+o single-owner interception with no-pill warning (3729979, ff81295, e1624c0, 2c8357e); the `:e` command is deferred by user call (design recorded in the spec); user E2E passed
- plan: `docs/superpowers/plans/2026-10-23-q-only-close.md`
  - done 2026-10-23 on the 2.0 train: :q is the only close (3ecb5a9, BREAKING CHANGE footer keys the 2.0 major); user E2E passed (q/Esc inert in normal mode, :q closes)
- spec: `docs/superpowers/specs/2026-10-22-editor-single-install-design.md`
- plan: `docs/superpowers/plans/2026-10-22-editor-single-install-plan.md`
  - done 2026-10-22: fix 66a3683 + behavioral tests f708be6, executed by delegated glm-5.3-flash worker and accepted in-session (521/521, tsc clean); user waived the sandbox E2E (the factory-composer boundary scenario only exists in the real environment) and validation rides daily use
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
