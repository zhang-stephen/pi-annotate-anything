---
title: Comment Input Cursor Movement - Plan
status: in-progress
progress: 0/2
spec: ../specs/2026-10-22-comment-cursor-design.md
---

# Comment Input Cursor Movement - Plan

Date: 2026-10-23

## Task 1: caret model and movement keys

- [ ] `CommentState` gains an explicit caret (code-unit offset into `text`); classify left/right/up/down/home/end `CommentKey` kinds ahead of the C0-control rejection in `toCommentKey` (`src/viewer/comment-mode.ts`).
- [ ] Accept the four legacy arrow sequences (modifiers ignored in v1) and kitty CSI-u arrow forms as normalized by the viewer input pipeline (`src/viewer/viewer.ts`).
- [ ] `char` and `newline` insert at the caret; `backspace` deletes the grapheme before the caret.
- [ ] left/right move one grapheme (CJK- and emoji-safe, not one code unit); home/end move to the current wrapped row's edges.
- [ ] up/down move between wrapped rows preserving a goal display column across soft wraps; expose `wrapCommentLines` row starts/ends (`src/tui/comment-input.ts`) so row movement and caret placement are exact.
- [ ] Unit tests: caret movement across grapheme boundaries (CJK, emoji, combining marks); insert and delete at the caret; up/down across soft-wrap boundaries with goal-column memory; home/end on wrapped rows; paste after moving the caret.
- [ ] Reducer equivalence tests: with the caret at end-of-text the behavior matches today's append-only semantics.
- [ ] `npm test` and `npx tsc --noEmit` green.

## Task 2: hardware cursor rendering

- [ ] Replace the painted fake cursor cell (`withCursorCell`, `src/viewer/viewer.ts`) with the terminal's hardware cursor positioned at the caret cell, shown while the comment box has focus and hidden while unfocused.
- [ ] Honor pi's `showHardwareCursor` setting via the exported SettingsManager when readable (default on).
- [ ] Update viewer render tests for the cursor change; `npm test` and `npx tsc --noEmit` green.
- [ ] User E2E (terminal-dependent, flagged): arrow keys under the kitty keyboard protocol (key repeat included) and under legacy sequences; insert and backspace mid-text.
