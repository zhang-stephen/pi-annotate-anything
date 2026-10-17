---
status: approved
---

# Annotate stacked comments & gutter semantics design

Scope: follow-up batch on top of the card-chrome work (merged to master).
Target release: 1.1.0 via release-please.
Also in scope: README.md rewrite and an AGENTS.md Releases section.

## Context

Two gaps surfaced during the card-chrome e2e:

1. When several pending drafts cover the same position, preview / `c` edit / `x` delete always target the most recent draft. Older drafts underneath cannot be reached without deleting the ones above.
2. A multi-line draft renders the gutter icon + count on EVERY covered line, where the count is "drafts covering this line". The gutter digits therefore sum to more than the title bar's (N) pending count; the two numbers can never be reconciled by the user.

## Design

### 1. Cycle key for stacked drafts (Tab)

- A STACK is the set of pending drafts covering the cursor position (line, col). Coverage is column-precise via the existing draftAtCursor rules: boundary lines respect startCol/endCol; whole-line (V-mode) drafts hit anywhere on the line.
- Default state (cursor not on any pending range): all pending ranges render plain underline; no target.
- Cursor on a stack: exactly one draft is the TARGET. Only normal mode has a target; visual and comment modes do not.
- Tab cycles the target through the stack, newest first, wrapping around. Tab is a no-op when the stack has fewer than 2 drafts.
- Target state is a cycle ordinal kept in viewer state (session only, not persisted).
- Reset rules (ordinal back to 0 = newest): cursor move, mode change, new draft added.
- `c` (edit) and `x` (delete) act on the target instead of always the most recent draft. `c` does not reorder the stack (ordering is by creation time; editing changes nothing).
- Succession on delete: after `x` removes the target at ordinal o, if the stack is empty there is no target; otherwise the new ordinal is o when o < new length (the next-older draft slides up), wrapping to 0 when o was the oldest. Stack of length 1 makes Tab a no-op.
- Performance: cycling is a reducer state change plus the existing render path; stack lookup is O(drafts) integer comparisons already paid on every cursor move. No IO, no async.

### 2. Target emphasis rendering

Decided: warning-colored bold underline for the target range (theme warning fg + SGR bold + SGR underline). Inverse video was considered and rejected: the emulated cursor cell and the visual selection are already inverse, so an inverse target range would hide the cursor inside itself.

- Target range: warning fg + bold + underline.
- Non-target stack members (drafts also covering the cursor): dim underline.
- Pending ranges not covering the cursor: plain underline (unchanged).
- The target's gutter marker (on its start line) stays warning-colored as today.
- When preview is on and the cursor is on a stack, the preview box shows the TARGET's comment, and its title gains a positional indicator `(i/n)` (1-based ordinal within the stack, newest = 1).

### 3. Gutter semantics: count where drafts START

- The icon + count field appears on a draft's START line only; the count is the number of pending drafts starting on that line. The sum of all gutter counts in the file equals the title bar's (N).
- Lines covered by a draft but not its start line show a dim vertical-bar continuation marker instead of the icon, so multi-line coverage stays visible without double counting.
- Priority rule when a line is both a start line (of one or more drafts) and a continuation of others: START WINS (icon + count), continuation is not shown. Rationale: the count-sum invariant is verifiable, while the lost continuation hint is cheap (the underline still marks coverage).
- Underline rendering is unchanged: every covered line shows the range underline regardless of gutter display.
- draftAtCursor hit testing is unchanged (covering drafts, not just starting ones).

Worked example: draft A covers lines 10-14, draft B covers lines 12-16.

| Line | Role | Gutter |
|------|------|--------|
| 10 | A starts | icon + 1 (warning) |
| 11 | A continues | dim vertical bar |
| 12 | B starts, A continues | icon + 1 (warning; start wins) |
| 13-14 | both continue | dim vertical bar |
| 15-16 | B continues | dim vertical bar |

Sum of counts = 2 = title bar (2).

### 4. Docs (same release)

- README.md rewrite: npm install instructions, npm + CI badges, refreshed key tables (Tab, p, c, x), stacked cycling behavior, new gutter semantics.
- AGENTS.md: new Releases section (release-please flow: never bump version or edit CHANGELOG by hand, merging the release PR publishes via npm trusted publishing).

## Out of scope

- Changing the title bar count semantics.
- Persisting cycle state across card sessions.
- Inverse-video target styling (rejected; see section 2).
