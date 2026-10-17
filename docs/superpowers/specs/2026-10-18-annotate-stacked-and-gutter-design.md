# Annotate stacked comments & gutter semantics design

Status: approved (design agreed in conversation; implementation pending)
Scope: follow-up batch on top of the card-chrome work (`feat/card-chrome`, merged).

## Context

Two gaps surfaced during the card-chrome e2e:

1. When several pending drafts cover the same position, preview / `c` edit / `x` delete always target the most recent draft. Older drafts underneath cannot be reached without deleting the ones above.
2. A multi-line draft renders the gutter icon + count on EVERY covered line, where the count is "drafts covering this line". The gutter digits therefore sum to more than the title bar's (N) pending count; the two numbers can never be reconciled by the user.

## Design

### 1. Cycle key for stacked drafts (Tab)

- Default state (cursor not on any pending range): all pending ranges render their underline as today; nothing changes.
- Cursor on a position covered by pending drafts: exactly one draft is the TARGET. Its range renders in warning-colored underline; other overlapping drafts covering the cursor render in dim underline. The preview box shows the target's comment (normal mode, preview on).
- Target selection: most recent draft initially (current draftAtCursor behavior); pressing Tab cycles to the next older draft covering the cursor, wrapping around. Moving the cursor resets the cycle to most-recent.
- `c` (edit) and `x` (delete) act on the current target instead of always the most recent draft.
- Tab in visual/comment modes keeps its current meaning (none); only normal mode gains the binding.

### 2. Gutter semantics: count where drafts START

- The icon + count field appears on a draft's START line only; the count is the number of pending drafts starting on that line. The sum of all gutter counts in the file equals the title bar's (N).
- Lines covered by a draft but not its start line show a dim continuation marker (glyph: vertical bar) instead of the icon, so multi-line coverage stays visible without double counting.
- Underline rendering is unchanged: every covered line shows the range underline.
- draftAtCursor hit testing is unchanged (covering drafts, not just starting ones).

## Out of scope

- Changing the title bar count semantics.
- Persisting cycle state across card sessions.
