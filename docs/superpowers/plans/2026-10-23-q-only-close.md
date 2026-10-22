---
title: ":q-Only Close - Plan"
status: done
progress: 1/1
spec: none
---

# ":q-Only Close - Plan"

Date: 2026-10-23

Records the execution of the Amendment (post-merge) in `plans/2026-10-22-vim-behavior-alignment.md`: the viewer's normal-mode `q` and Esc close mappings are removed; `:q` becomes the only close.

## Task 1: remove q/Esc close

Done in 3ecb5a9 (accepted: 583/583, tsc clean; BREAKING CHANGE footer keys the 2.0 major). User E2E (q/Esc inert in normal mode, :q closes) rides the train close-out pass.

- [x] `src/viewer/state.ts`: delete the normal-mode `q` -> close mapping; Esc keeps visual->normal and becomes a no-op in normal mode (comment/search/command cancel paths untouched).
- [x] `src/viewer/status-line.ts`: hint changes from `q/Esc close` to `:q close`.
- [x] Update viewer state tests covering q/Esc close; add a test that normal-mode Esc is a no-op and that `:q` still closes.
- [x] Commit message carries a `BREAKING CHANGE:` footer so release-please cuts the 2.0 major (the single-key closes are gone; `:q` is the only close).
- [x] `npm test` and `npx tsc --noEmit` green.
