---
title: Vim behavior alignment (curswant + showcmd) implementation plan
status: draft
progress: 0/2
spec: none
---

# Vim behavior alignment (curswant + showcmd) implementation plan

Spec: none (plan-only: both designs are small and fully captured here; the MVP spec never codified the column clamp, so there is no approved decision to amend)
Branch: `feat/vim-alignment`, worktree `.pi/worktrees/vim-alignment`
Companion: `docs/superpowers/plans/2026-10-22-viewer-command-line.md` (independent work, but both touch `src/viewer/state.ts` and `test/viewer/state.test.ts`; whoever lands second rebases and re-runs the suite)

## Task 1: curswant goal-column memory

Files: `src/viewer/state.ts`, `src/viewer/movement.ts`, `test/viewer/state.test.ts`

- [ ] `ViewerState` gains `wantedCol?: number | null` (optional-shaped, undefined/null = none).
- [ ] `j`/`k` arms in `state.ts` (lines ~131-135; the arrow keys `\x1b[B`/`\x1b[A` alias into the same case bodies): before moving, capture `wanted = state.wantedCol ?? state.cursor.col`, land at `min(wanted, lineLength(target))`, and store `wantedCol: wanted` so consecutive vertical moves keep the goal.
- [ ] Reset `wantedCol` to null on: `h`, `l` (lines ~123-127), `G` (line ~143), `gg` (pending-g completion), `n`/`N` jumps (lines ~155-156), `/` submit jump, and every mode transition (the `anchor: null` returns around lines 171-228).
- [ ] Arrow keys inherit curswant through the shared case bodies (`\x1b[A`=k, `\x1b[B`=j, `\x1b[C`=l, `\x1b[D`=h, `state.ts` ~123-135): Up/Down preserve, Left/Right reset; pin each escape sequence with its own test so a future refactor that splits the arms cannot silently drop arrows (held arrows repeat via `normalizeKeyRepeat`, so the goal must survive repeats).
- [ ] Mouse has no touchpoint today; leave a one-line code comment where clicks will land: clicks reset `wantedCol`.
- [ ] Tests in `test/viewer/state.test.ts` (~12): `j` over a short line restores the original column on the way back; `k` mirrors; repeated `j` through a field of short lines keeps the goal column; `h` resets; `l` resets; `gg` resets; `G` resets; `n` jump resets; mode transition resets; visual-mode `j`/`k` preserve too; Up (`\x1b[A`) and Down (`\x1b[B`) preserve the goal across short lines; Left (`\x1b[D`) and Right (`\x1b[C`) reset.
- [ ] Steps: write the failing tests first, confirm they fail, implement, suite green, commit `feat(viewer): preserve goal column across short lines`.

## Task 2: showcmd pending keys

Files: `src/viewer/movement.ts`, `src/viewer/viewer.ts`, `src/viewer/status-line.ts`, `test/viewer/status-line.test.ts`, `test/viewer/viewer.test.ts`

- [ ] Pure derivation `pendingKeysOf(state: ViewerState): string` in `movement.ts`: `(state.count !== null ? String(state.count) : "") + (state.pending ?? "")`.
- [ ] `renderCommandLine` in `status-line.ts` (line ~159): when input is not an active prompt, right-align the pending string inside the cmdline row; a transient message renders left and the keys right; when they would overlap, the message wins and the keys are dropped.
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
