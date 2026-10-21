---
title: Vim behavior alignment (curswant + showcmd) implementation plan
status: in-progress
progress: 1/2
spec: none
---

# Vim behavior alignment (curswant + showcmd) implementation plan

Spec: none (plan-only: both designs are small and fully captured here; the MVP spec never codified the column clamp, so there is no approved decision to amend)
Branch: `feat/vim-alignment`, worktree `.pi/worktrees/vim-alignment`
Companion: `docs/superpowers/plans/2026-10-22-viewer-command-line.md` (independent work, but both touch `src/viewer/state.ts` and `test/viewer/state.test.ts`; whoever lands second rebases and re-runs the suite)

## Task 1: curswant goal-column memory

Files: `src/viewer/state.ts`, `src/viewer/movement.ts`, `test/viewer/state.test.ts`

- [x] `ViewerState` gains `wantedCol?: number | null` (optional-shaped, undefined/null = none).
- [x] `j`/`k` arms in `state.ts` (lines ~131-135; the arrow keys `\x1b[B`/`\x1b[A` alias into the same case bodies): before moving, capture `wanted = state.wantedCol ?? state.cursor.col`, land at `min(wanted, lineLength(target))`, and store `wantedCol: wanted` so consecutive vertical moves keep the goal.
- [x] Reset `wantedCol` to null on: `h`, `l` (lines ~123-127), `0`, `$`, `G` (line ~143), `gg` (pending-g completion), `n`/`N` jumps (lines ~155-156), `/` submit jump, and every mode transition (post-reducer mode comparison, see `resetWantedColOnModeChange`).
- [x] ctrl+d, ctrl+u, PgDn, and PgUp join the vertical family: they preserve and re-aim at the stored goal exactly like `j`/`k` (acceptance fix, commit `095ac08`).
- [x] Arrow keys inherit curswant through the shared case bodies (`\x1b[A`=k, `\x1b[B`=j, `\x1b[C`=l, `\x1b[D`=h, `state.ts` ~123-135): Up/Down preserve, Left/Right reset; each escape sequence has its own test so a future refactor that splits the arms cannot silently drop arrows (held arrows repeat via `normalizeKeyRepeat`, so the goal must survive repeats).
- [x] Mouse has no touchpoint today; the mode-reset helper carries the one-line note that clicks reset `wantedCol` when they land.
- [x] Tests in `test/viewer/state.test.ts` (16 new + 1 rewritten): `j` over a short line restores the original column on the way back; `k` mirrors; repeated `j` through a field of short lines keeps the goal column; `h` resets; `l` resets; `0`/`$` reset; ctrl+d/u and PgDn/PgUp keep the goal; `gg` resets; `G` resets; `n` jump resets; mode transition resets; visual-mode `j`/`k` preserve too; Up and Down preserve the goal across short lines; Left and Right reset. The old clamp-sticks test in `test/viewer/movement.test.ts` was rewritten to the new semantics (supervisor-approved single-test boundary extension).
- [x] Steps: write the failing tests first, confirm they fail, implement, suite green, commit `feat(viewer): preserve goal column across short lines` (`bbf1150`, fix follow-up `095ac08`).

## Task 2: showcmd pending keys

Files: `src/viewer/movement.ts`, `src/viewer/viewer.ts`, `src/viewer/status-line.ts`, `test/viewer/status-line.test.ts`, `test/viewer/viewer.test.ts`

- [ ] Pure derivation `pendingKeysOf(state: ViewerState): string` in `movement.ts`: `(state.count !== null ? String(state.count) : "") + (state.pending ?? "")`.
- [ ] `renderCommandLine` in `status-line.ts` (line ~159): when no input prompt is active, right-align the pending string in the cmdline row alongside the left-side hints; a transient message already owns the right corner (accent), so while a message is showing the keys are dropped entirely (vim's shared-corner behavior).
- [ ] Suppressed entirely while a prompt (search, comment, command) is active.
- [ ] Tests: derivation cases (count only / pending `g` only / both / none); right alignment; message + keys coexistence; overlap drops keys; prompt-active suppression.
- [ ] Steps: failing tests first, implement, suite green, commit `feat(viewer): show pending keys in the cmdline row`.

## Review focus

- The count is stored as a number, so `03` displays as `3` (vim shows `03` literally): accepted divergence, one derivation test pins `String(count)`.
- A digit clears `pending-g` (existing rule): the display must follow state the same frame, never showing a stale `3g` after the digit lands.
- A long transient message plus keys in a narrow card must drop the keys, not wrap or clip the row.
- Mode transitions and comment edits must not leak a stale `wantedCol` into the next session of j/k.

## Verification

`npm test` and `npx tsc --noEmit` green.
Manual E2E (user, real terminal): type `3` and watch `3` appear right-aligned then clear on `j`; `g` shows `g` then `gg` fires; goal column across short lines by feel.
