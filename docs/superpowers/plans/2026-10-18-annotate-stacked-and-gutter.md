# Annotate stacked cycling & gutter semantics implementation plan

Spec: `docs/superpowers/specs/2026-10-18-annotate-stacked-and-gutter-design.md` (approved)
Branch: `feat/stacked-gutter`, worktree `.pi/worktrees/stacked`
Target: release 1.1.0 (release-please)

## Task 1: stack targeting state machine

Files: `src/viewer-state.ts`, `test/viewer-state.test.ts`

- [ ] Add `cycleOrdinal` (default 0) to viewer state.
- [ ] Stack helper: ordered list (newest first) of pending drafts covering (cursor.line, cursor.col), reusing draftAtCursor coverage rules.
- [ ] Normal-mode Tab: advance ordinal modulo stack length; no-op when stack < 2.
- [ ] Reset ordinal to 0 on: cursor move, mode change, draft added.
- [ ] `c` / `x` act on the current target (stack[ordinal]) instead of most-recent.
- [ ] Succession on delete: ordinal stays when < new length, wraps to 0 when it was the oldest; empty stack clears target.
- [ ] Unit tests: cycling order, wrap-around, resets, target-aware c/x, succession incl. oldest-delete wrap and empty-stack boundary, stack of 1 Tab no-op.

## Task 2: paint (target emphasis + gutter semantics + preview indicator)

Files: `src/viewer.ts`, `src/card-chrome.ts`, `test/viewer.test.ts`, `test/card-chrome.test.ts`

- [ ] Target range: theme warning fg + bold + underline spans (normal mode only).
- [ ] Non-target stack members covering the cursor: dim underline.
- [ ] Pending ranges not covering the cursor: plain underline (unchanged).
- [ ] Gutter: icon + count only on start lines (count = drafts starting there); continuation lines get dim vertical bar; start wins over continuation on shared lines.
- [ ] Sum-of-counts invariant test: sum of gutter counts == pending count.
- [ ] Preview box title gains `(i/n)` 1-based positional indicator when cursor is on a stack with n >= 2.
- [ ] Regression: visual-mode selection inverse unchanged; cursor cell unchanged.

## Task 3: docs + bookkeeping

Files: `README.md`, `AGENTS.md`, `docs/superpowers/STATUS.md`

- [ ] README rewrite: npm install (`npm i pi-annotate-anything`), npm version + CI badges, refreshed key tables (Tab cycling, p, c, x), stacked cycling behavior, new gutter semantics with worked example.
- [ ] AGENTS.md: Releases section (release-please flow, no manual version/CHANGELOG edits, npm trusted publishing).
- [ ] STATUS.md: plan done (3/3); merge bookkeeping.
