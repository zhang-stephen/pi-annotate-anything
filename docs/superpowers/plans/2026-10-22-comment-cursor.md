---
title: Comment Input Cursor Movement - Plan
status: done
progress: 2/2
spec: ../specs/2026-10-22-comment-cursor-design.md
---

# Comment Input Cursor Movement - Plan

Date: 2026-10-23

## Task 1: caret model and movement keys

Done in b3e0c1c (accepted: 561/561, tsc clean; two delegated workers, one supervisor steer on grapheme/width invariants).

- [x] `CommentState` gains an explicit caret (code-unit offset into `text`); classify left/right/up/down/home/end `CommentKey` kinds ahead of the C0-control rejection in `toCommentKey` (`src/viewer/comment-mode.ts`).
- [x] Accept the four legacy arrow sequences (modifiers ignored in v1) and kitty CSI-u arrow forms as normalized by the viewer input pipeline (`src/viewer/viewer.ts`).
- [x] `char` and `newline` insert at the caret; `backspace` deletes the grapheme before the caret.
- [x] left/right move one grapheme (CJK- and emoji-safe, not one code unit); home/end move to the current wrapped row's edges.
- [x] up/down move between wrapped rows preserving a goal display column across soft wraps; expose `wrapCommentLines` row starts/ends (`src/tui/comment-input.ts`) so row movement and caret placement are exact.
- [x] Unit tests: caret movement across grapheme boundaries (CJK, emoji, combining marks); insert and delete at the caret; up/down across soft-wrap boundaries with goal-column memory; home/end on wrapped rows; paste after moving the caret.
- [x] Reducer equivalence tests: with the caret at end-of-text the behavior matches today's append-only semantics.
- [x] `npm test` and `npx tsc --noEmit` green.

## Task 2: hardware cursor rendering

Implementation done in ced4475 (accepted: 565/565, tsc clean; the SettingsManager read the original bullet demanded was a design error and is gone -- the marker contract carries both render modes). Amended after user E2E: the `:` cmdline and the `/` search input emit the same marker at their caret cells (bd73a4f, user call 2026-10-23), and comment box rows now render exactly at the wrap width so a row-end caret can never be truncated away (20acb09). User E2E below stays open until the train close-out pass.

- [x] Replace the painted fake cursor cell (`withCursorCell`, `src/viewer/viewer.ts`) with the terminal's hardware cursor positioned at the caret cell, shown while the comment box has focus and hidden while unfocused.
- [x] Emit CURSOR_MARKER at the caret cell while focused (Focusable contract); the TUI owns the `showHardwareCursor` on/off branch, so the extension never reads the setting.
- [x] Update viewer render tests for the cursor change; `npm test` and `npx tsc --noEmit` green.
- [x] User E2E (terminal-dependent, flagged): arrow keys under the kitty keyboard protocol (key repeat included) and under legacy sequences; insert and backspace mid-text.
  Passed 2026-10-23 (user E2E round two: wrap-width row-end caret and one-press transitions re-verified after fixes).
