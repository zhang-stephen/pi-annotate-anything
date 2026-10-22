---
title: Composer editor single-install implementation plan
status: done
progress: 3/3
spec: ../specs/2026-10-22-editor-single-install-design.md
---

# Composer editor single-install implementation plan

Spec: `docs/superpowers/specs/2026-10-22-editor-single-install-design.md`
Small fix: direct on master per AGENTS.md (review gates still apply); no worktree needed.

## Task 1: rewrite the choreography in index.ts

Files: `index.ts`

- [x] Move editor registration into the `session_start` handler: capture `savedFactory = ctx.ui.getEditorComponent()` and register the same wrapped factory body used by today's `installComposer` (chain `withTokenRecolor(savedFactory(...))`, `AnnotateEditor` fallback when nothing was configured).
- [x] Delete the install-on-demand and restore-on-idle paths: `installComposer`, `restoreComposerIfIdle`, and their call sites on card open/close and `message_start`; remove the now-unused idle tracking state.
- [x] Add `session_shutdown` restore of `savedFactory` (guard for double shutdown).

Done in worktree commit 66a3683 (accepted: 514/514, tsc clean, approved 4-line stub deviation in test/index.test.ts).

## Task 2: unit tests to the new semantics

Files: `test/` (the suite covering index.ts composer choreography)

- [x] `session_start` registers exactly once; a second `session_start` (reload shape) re-registers without double-wrapping render.
- [x] The wrapped factory delegates to the previously configured factory when one exists and to `AnnotateEditor` otherwise.
- [x] Card open, card close (with and without pending pills), and `message_start` leave the editor factory untouched (rewrite the old install/restore tests).
- [x] `session_shutdown` restores the saved factory and tolerates a second call.
- [x] `npm test` and `npx tsc --noEmit` green.

Done in worktree commit f708be6 (accepted: 521 tests = 514+7, fail 0, tsc clean; seven behavioral tests pinning each bullet).

## Task 3: manual E2E + commit

- [x] Sandbox run (`PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`): annotate a range, submit, close the card, then Up-browse the composer history across the annotation boundary; repeat with a factory-based composer configured to reproduce the hard-stop case. Terminal-dependent: user E2E pass required.
  Waived (user call 2026-10-22): the sandbox cannot reproduce the factory-composer boundary scenario, which only exists in the real environment; validation rides daily use.
- [x] User confirms the E2E, then commit `fix(editor): register the composer editor once per session` (self-contained message describing the history-loss mechanism and the single-install fix).
  Code commits already on the branch (66a3683, f708be6); release authorized by user call 2026-10-22 without the sandbox E2E.
