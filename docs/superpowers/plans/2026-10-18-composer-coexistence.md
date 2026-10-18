---
title: Composer Coexistence Fix Plan
status: done
progress: 3/3
spec: none
---

# Composer Coexistence Fix Plan

Bug: the extension installed `AnnotateEditor` unconditionally at `session_start`, discarding any previously registered editor factory.
With the package installed globally (load order: zentui first, us second), zentui's composer was replaced in every session.
During `pi -e` dev the load order was reversed (CLI extensions first), so zentui layered on top and the conflict was invisible.

Root cause: two violations of the composer coexistence contract that zentui (and pi generally) expects: (1) factories must be predecessor-preserving - decorate the instance the previous factory produces instead of replacing it; (2) a global composer override should only be active while its feature is actually needed.

## Tasks

- [x] **1.
  Predecessor-preserving composition** - `withTokenRecolor(editor, getTokens)` decorator in `src/editor.ts` wraps an existing editor instance's `render()`; `AnnotateEditor` now delegates to it.
  `installComposer` decorates the saved predecessor's instance, falling back to `AnnotateEditor` only when no predecessor exists.
- [x] **2.
  Lazy install / idle restore** - no composer override at `session_start`; installed by `/annotate`, restored (saved factory, never blind `undefined`) when no pill tokens remain: card closed with nothing pending, or after submit (`message_start` prune), plus `session_shutdown` safety.
- [x] **3.
  Verification** - `npx tsc --noEmit` clean; 273/273 tests pass (2 new `withTokenRecolor` tests).
  Interactive e2e with zentui skipped per user decision; coexistence verified by construction (decorator never replaces the predecessor's behavior).

## Follow-ups

- Release as 1.1.1 via release-please (`fix:` commit), then `pi update`.
