---
title: Composer editor single-install - Design
status: approved
plan:
  - ../plans/2026-10-22-editor-single-install-plan.md
---

# Composer editor single-install - Design

Date: 2026-10-22

## Problem

The extension swaps the composer editor around the annotation flow: it registers a token-recolor editor when a card session needs pills and restores the previously configured factory when idle (card close without pending pills, `message_start` after submit).
pi's `setCustomEditorComponent` builds a new editor instance per swap and copies text, callbacks, appearance, and action handlers -- but not prompt history, which is private to the editor instance.
Submits during an annotation window land in the soon-discarded instance, so Up history browsing in the composer breaks at annotation-session boundaries.

Upstream feature request: earendil-works/pi#11285 (prior reports #8798/#5466 were auto-closed without action).

## Approach

Register the recolor wrapper once per session and never swap again.
The composer keeps a single editor instance for the whole session, `addToHistory` always lands in that instance, and history can no longer split.

## Behavior

- `session_start` captures the currently configured factory (`ctx.ui.getEditorComponent()`), then registers the same wrapped factory used today: chained `withTokenRecolor(savedFactory(...))`, falling back to `AnnotateEditor` when nothing was configured.
- The card open/close and `message_start` handlers no longer touch the editor factory; the install/restore choreography and its idle tracking are deleted.
- With no pending tokens the wrapper is a pure render passthrough (recolor no-ops) and never intercepts input, so behavior outside annotation sessions is unchanged.
- `session_shutdown` restores the saved factory, keeping teardown symmetric; pi discards the TUI at shutdown anyway, so this is tidiness, not correctness.
- A later extension registering its own editor chains on top of ours, exactly as chaining works today; `/reload` re-runs `session_start` and re-registers once (the `/reload` history loss itself is upstream #8798's story).

## Tradeoffs

- The composer is permanently wrapped by our decorator for the session.
  The wrapper is stateless (token list is read live from the store) and behavior-transparent when idle, so the MVP principle "leave the user's configured editor untouched" is preserved at the behavior level, relaxed at the instance level.
- The tray-pill direction (recorded in STATUS.md) needs a permanent wrapper anyway, so this fix is also its foundation.

## Testing

- Unit: `session_start` registers exactly once and double registration does not double-wrap; the wrapped factory chains the previously configured factory; card open/close and `message_start` leave the factory untouched; `session_shutdown` restores the saved factory; existing install/restore choreography tests are rewritten to the new semantics.
- `npm test` and `npx tsc --noEmit` green.
- Manual E2E (terminal-dependent, user pass): annotate, submit, close the card, then Up-browse history across the annotation boundary in the sandbox (`PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`); with a factory-based composer configured, the boundary must no longer truncate browsing.

## Non-goals

- Upstream history carry-over across swaps (#11285) and `/reload` history persistence.
- The tray-pill redesign, which has its own upcoming spec.
