---
title: Comment Input Cursor Movement - Design
status: in-progress
plan:
  - ../plans/2026-10-22-comment-cursor.md
---

# Comment Input Cursor Movement - Design

Date: 2026-10-22

## Problem

Comment input is an append-only buffer: every character appends at the end, backspace deletes the tail, and the caret implicitly sits at end-of-text.
Arrow keys cannot move the caret: their escape chunks contain Esc, and `toCommentKey` rejects any chunk containing C0 controls (`src/viewer/comment-mode.ts`), so caret movement, mid-text insert, and mid-text delete are all impossible.
The caret is also fake: the viewer paints a styled cursor cell (`withCursorCell` in `src/viewer/viewer.ts`), so blink style and rate ignore the user's terminal defaults.

## Current key set (facts)

- printable chunks (pastes, astral chars) append
- Enter submits; ctrl+j / shift+enter insert a newline
- backspace deletes the last character
- Esc cancels
- every other chunk containing C0 controls (tabs, arrow sequences, kitty CSI-u forms) is ignored

## Approach

Give `CommentState` an explicit caret (a code-unit offset into `text`) and classify movement keys ahead of the control-character rejection.

- New `CommentKey` kinds: left, right, up, down, home, end.
- Chunks accepted as movement: the four legacy arrow sequences `\x1b[A`..`D` (with and without modifiers -- modifiers are ignored in v1), and kitty CSI-u arrow forms as normalized by the viewer input pipeline (`src/viewer/viewer.ts`).
- `char` inserts at the caret; `newline` inserts at the caret; `backspace` deletes the grapheme before the caret.
- left/right move one grapheme (CJK- and emoji-safe), not one code unit; home/end move to the current wrapped row's edges; up/down move between wrapped rows preserving a goal display column across soft wraps.
- `wrapCommentLines` already computes row starts/ends internally (`src/tui/comment-input.ts`); expose them so row movement and caret placement are exact.
- Caret rendering switches to the terminal's hardware cursor: position it at the caret cell and show it while the comment box has focus, so blink style and rate follow the user's terminal defaults, exactly like pi's composer. Honor pi's `showHardwareCursor` setting when readable via the exported SettingsManager (default on), and keep the cursor hidden while the box is unfocused.

Out of scope for v1: word-wise motion (ctrl+left/right), kill-line, delete-forward, and in-comment selection.

## Testing

- Unit: caret movement across grapheme boundaries (CJK, emoji, combining marks); insert and delete at the caret; up/down across soft-wrap boundaries with goal-column memory; home/end on wrapped rows; paste after moving the caret.
- Reducer equivalence: with the caret at end-of-text the behavior matches today's append-only semantics.
- `npm test` and `npx tsc --noEmit` green.
- Manual E2E in a real terminal: arrow keys under the kitty keyboard protocol (key repeat included), then under TERM=linux-style legacy sequences; insert and backspace mid-text.
