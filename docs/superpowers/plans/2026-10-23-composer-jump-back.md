---
title: Composer Jump Back - Plan
status: in-progress
progress: 0/1
spec: ../specs/2026-10-23-composer-jump-back-design.md
---

# Composer Jump Back - Plan

Date: 2026-10-23

## Task 1: alt+o interception and reopen

- [ ] The composer wrapper proxies key handling before the inner editor: `alt+o` is intercepted, every other key (including lone Esc) is forwarded unchanged.
- [ ] With no tokens in the buffer, `alt+o` is a no-op pass-through.
- [ ] Parse the current buffer's tokens with the transform.ts parser and take the LAST one.
- [ ] Open the viewer via the /annotate path for that token's file; viewport centers on the token's range with the cursor at the range start; the store-driven pending replay renders all of the file's comments (existing mechanism, no extra work).
- [ ] Clamp the range on files shortened or changed on disk; fail-open like the viewer does today.
- [ ] Unit tests: last-token selection from mixed buffers; no-token pass-through; open payload carries file + focus range; clamp on short files; alt+o intercepted before the inner editor with everything else forwarded.
- [ ] `npm test` and `npx tsc --noEmit` green.
- [ ] User E2E (terminal-dependent, flagged): real `alt+o` key encoding (ESC-o sequence) and its disambiguation against a lone Esc in the composer.

Deferred (user call 2026-10-23): the `:e`/`:edit` command is not implemented on this train; the spec records the design and it ships when cross-file or multi-buffer demand materializes.
