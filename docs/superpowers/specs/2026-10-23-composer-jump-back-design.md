---
title: Composer Jump Back - Design
status: in-progress
plan:
  - ../plans/2026-10-23-composer-jump-back.md
---

# Composer Jump Back - Design

Date: 2026-10-23

## Problem

The composer can hold pending annotation tokens, but once the annotation card closes there is no way back: to re-check a source location (or fix a comment before sending) the user must re-run /annotate and navigate to the spot by hand.
This closes the review loop between attaching an annotation and sending it.

## Current mechanics (facts)

- The permanent composer wrapper shipped in 1.5.2 (single-install registration) is a stateless render passthrough; it can proxy key handling before the inner editor.
- pi-tui's editor binds no alt-combinations and pi's interactive mode binds no alt+o, so alt+o is free.
- Token parsing of the composer buffer already exists (src/core/transform.ts); it resolves file and range for every token.
- The viewer is store-driven: it takes a `pendingDrafts: () => PendingDraft[]` live getter (wired to `AnnotationStore.list()`), so opening a file replays every pending comment of that file with markers; normal-mode `c` opens the draft's comment editor prefilled and `x` deletes it.
- The ex layer (`:` command mode with Tab completion) is wired; command specs support `short` prefixes.

## Approach

1. `alt+o` in the composer wrapper: intercept before the inner editor.
   Parse the current buffer's tokens with the transform.ts parser; with no tokens, pass the key through unchanged.
2. Take the LAST token (most recent attachment; symmetric with the future alt+backspace semantics).
3. Open the viewer via the /annotate path for that token's file.
   The store getter already wired there replays all of the file's pending comments automatically; nothing extra is needed for full comment restore.
4. Focus: viewport centers on the target range and the cursor lands at the range start; the user can then `c` (edit prefilled) or `x` (delete) at that spot.
5. Viewer gains `:e` / `:edit <file>`: completion lists the invoking buffer's token files (deduplicated); opening centers the file's last token range if it has tokens, otherwise lands at the top.
   The same store-driven replay applies.
   DEFERRED (user call 2026-10-23): not on the 2.0 train; the cross-file demand and any multi-buffer support land first.
6. Scope invariant: both alt+o and :e completion scope to the invoking buffer's tokens.
   When pi grows multi-buffer support, each buffer keeps its own wrapper, so "this buffer's last token" stays well-defined and cross-buffer enumeration is never needed.

### Multi-buffer alternative rejected

Iterating all pills across buffers, deduplicating, and opening every file was rejected: it fights the single-viewer overlay model (no splits, no stacking semantics) and invents a cross-buffer merge that per-buffer scoping makes unnecessary.
`:e` covers hopping between files incrementally, vim-style.

### Edges

- File changed on disk since annotation (shorter, or gone): clamp the range to EOF and open what is there; fail-open, consistent with viewer behavior today.
- Multiple tokens in the same file: last-token focus wins; the others still replay as markers.
- No tokens in the buffer: alt+o is a no-op pass-through; :e completion is empty.

## Testing

- Unit: last-token selection from mixed buffers; no-token pass-through; :e completion dedup and ordering; open payload carries file + focus range; clamp on short files.
- Wrapper: alt+o intercepted before the inner editor; every other key forwarded.
- Terminal-dependent (user E2E): real alt+o key encoding (ESC-o sequence) and its disambiguation against a lone Esc in the composer.
