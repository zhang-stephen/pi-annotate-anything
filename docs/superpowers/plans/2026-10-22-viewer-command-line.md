---
title: Viewer command line (:) implementation plan
status: in-progress
progress: 4/6
spec: ../specs/2026-10-22-viewer-command-line-design.md
---

# Viewer command line (:) implementation plan

Spec: `docs/superpowers/specs/2026-10-22-viewer-command-line-design.md` (approved)
Branch: `feat/command-line`, worktree `.pi/worktrees/cmdline`
Companion: `docs/superpowers/plans/2026-10-22-vim-behavior-alignment.md` (independent work, but both touch `src/viewer/state.ts` and `test/viewer/state.test.ts`; whoever lands second rebases and re-runs the suite)

## Global constraints

- `src/viewer/*` stays pure: no I/O, no pi imports; colors injected as `(text) => string` functions.
- `commands.ts` imports only types from `state.ts` (type-only import, erased at runtime) and runtime helpers from `movement.ts`, so `state.ts` can import `executeCommand` without a runtime cycle.
- Error message texts are exact: `E492: Not an editor command: <name>`, `E464: Ambiguous command`, `E488: Trailing characters`.
- Mode entry drops any pending count, identical to `/` entry.

## Task 1: command module

Files: create `src/viewer/commands.ts`, create `test/viewer/commands.test.ts`, plus the granted two-line `searchHL?: boolean` field in `src/viewer/state.ts` (no logic)

- [x] Types: `type Parsed = { kind: "none" } | { kind: "address"; line: number } | { kind: "command"; name: string; args: string[] }`.
- [x] `parseCommandLine(raw: string): Parsed`: trim; empty = none; `^\d+$` = address (1-based); otherwise whitespace-split into name + args (`:5q` parses as name `5q` and fails resolution, per spec).
- [ ] `resolveAgainst(table: CommandSpec[], name: string): CommandSpec | "not-found" | "ambiguous"`: match iff `spec.name.startsWith(name) && name.startsWith(spec.short)`; exactly one match wins.
- [x] `CommandSpec { name: string; short: string; args: "none"; run(state, lines, viewport): ViewerResult }`; table: `quit` (short `q`), `nohlsearch` (short `noh`).
- [x] `executeCommand(state, raw, lines, viewport)`: none returns to normal silently; address jumps with exactly `{count}G` semantics via `moved()`; command runs its spec; resolution errors return to normal mode with the exact E-code message.
- [x] Tests (18 in `test/viewer/commands.test.ts`): parser; resolver including `no` on the not-found side (spec short-bound rule; the dispatch examples said hit, the spec wins) and crafted ambiguity; executors including three full-state `:7` vs `7G` parity cases through `reduceViewer` and exact E-code texts (E464 via a temporarily pushed crafted entry, restored in `finally`).
- [x] Steps: failing tests first (ERR_MODULE_NOT_FOUND confirmed), implement, suite green (456 pass), commit `4ba55fd`. The address path also resets `wantedCol` exactly like the G arm.

## Task 2: command mode in the reducer

Files: `src/viewer/state.ts`, `test/viewer/state.test.ts`

- [x] `ViewerMode` gains `"command"`; `ViewerState.command?: { value: string } | null`.
- [x] Normal-mode `:` enters command mode and drops the count; `:` is inert in visual/comment/search modes.
- [x] Editing mirrors `searchStep` exactly, through the shared `toCommentKey` classifier: printable chunks append whole; Backspace pops one code unit and is a no-op at empty (never exits); Esc returns to normal; Enter runs `executeCommand`; control/newline-shaped keys are ignored.
- [x] `ViewerState.searchHL?: boolean` (undefined = true): `nohlsearch` sets false; `n`/`N` re-light, and the `/` path re-lights only when Enter lands a completed search (Esc-cancel and invalid-pattern keep-editing leave it untouched).
- [x] Tests (10 in `test/viewer/state.test.ts`): entry drops count and clears the goal column; inert elsewhere; append/backspace/Esc/Enter transitions; quit surfaces the `close` effect; `:zzz` sets the E492 message; `:noh` then `n` re-lights (`searchHL` true again); empty Enter exits silently; control keys ignored.
- [x] Steps: failing tests first, implement, suite green (466 pass), commit `07b68e5`. Mid-task type gap escalated and granted: `cardModeOf` totality forced the type-level half of Task 3 (CardMode entry, badge constant, empty hints) into this commit.

## Task 3: rendering

Files: `src/viewer/status-line.ts`, `test/viewer/status-line.test.ts`

- [x] `CardMode` gains `"command"`; badge `-- COMMAND --`; `FOOTER_HINTS` entry is the empty string (type-level half landed in Task 2 commit `07b68e5` under the totality grant).
- [x] The cmdline renders through the existing `{ kind: "input", prompt: ":", value, cursorCol }` path in `renderCommandLine`; no new renderer branch beyond the prompt character (proven by pinning tests, no source change needed).
- [x] Tests (4 in `test/viewer/status-line.test.ts`, tests-only commit `ad9e468`): badge text with exact 40-col geometry, `:` prompt with typed value and inverse cursor cell, empty hints row, and no `[rank/total]` segment in command mode.
- [x] Steps: tests written as regression pinning per the dispatch brief, none red (generic path already satisfied the contract), suite green (470 pass), commit `ad9e468`.

## Task 4: shell wiring

Files: `src/viewer/viewer.ts`, `test/viewer/viewer.test.ts`

- [x] Render `state.command` as the cmdline input while command mode is active (the reducer handles keys; the shell only paints); the command branch mirrors the search input construction exactly, prompt and value source differing only.
- [x] Highlight suppression: when `searchHL === false`, the query resolves to null so the existing guard skips match spans and leaves searchStatus unsupplied (no `[rank/total]` segment); `true`/undefined behavior is byte-identical, pinned by a default test.
- [x] Tests (5 in `test/viewer/viewer.test.ts`): `:` input painted with typed value and inverse cursor cell; Esc restores the normal hints row and pending keys; `:noh` clears all highlight spans and the segment with `n` re-lighting both; a resubmitted `/` re-lights both; the undefined-default pin.
- [x] Steps: failing tests first (4 confirmed red for the right reason), implement, suite green (475 pass), tsc clean, commit `6244566`.

## Task 5: command name completion (unified panel)

Spec: the Completion section of `docs/superpowers/specs/2026-10-22-viewer-command-line-design.md`.

Files: `src/viewer/commands.ts`, `src/viewer/state.ts`, create `src/viewer/completion-panel.ts`, `src/viewer/viewer.ts`, plus tests in `test/viewer/commands.test.ts`, `test/viewer/state.test.ts`, `test/viewer/completion-panel.test.ts`, `test/viewer/viewer.test.ts`.

- [ ] `CommandSpec` gains `desc: string` (quit: "close the card", nohlsearch: "clear search highlight") and `completeFor(input: string): { name: string; desc: string }[]`: empty input -> []; input containing whitespace -> [] (no arg source yet); otherwise COMMANDS entries whose name starts with the input, table order.
- [ ] Command draft gains cycling state (`completion?: { anchor: string; index: number }`): first Tab snapshots the anchor and writes candidates(anchor)[0] into the value; further Tabs advance and wrap, writing the selected name; any other key clears it. The panel shows the anchor list with the selection inverted while cycling, the live candidates(value) list with no selection otherwise.
- [ ] New pure module `completion-panel.ts`: renders at most 5 rows (`name` + two spaces + dim desc, selected row inverted, colors injected, width-truncated); viewer.ts paints them over the bottom-most body rows while command mode shows candidates; badge, position, and the cmdline row are never displaced.
- [ ] Tests: source cases (empty, bare word, command+space, no match, unique); Tab accept, cycle, wrap, anchor freeze while value changes, reset on typing; panel rows, selection styling, 5-row truncation; viewer integration (typed char shows the row, Tab completes the value, bare `:` shows nothing, mode exit kills the panel).
- [ ] Steps: failing tests first, implement, suite green, commit `feat(viewer): complete command names through the unified panel`.

## Task 6: manual E2E (user)

- [ ] Sandbox: `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts` with /tmp fixtures (long lines, CJK, CRLF).
- [ ] Round 1 regressions: `:7` then `:` re-enters a clean input (no swallowed colon); Backspace at empty exits to normal in both `:` and `/` modes; `:q!` runs quit and `:q!!` shows E492.
- [ ] Round 2 completion: bare `:` shows no panel; `n` shows the nohlsearch row with dim description; Tab completes the value; a space after a command hides the panel; Enter executes the completed name.
- [ ] Original cases: `:q` closes; `:7` jumps like `7G` (and `:999` clamps); `/foo` then `:noh` clears highlight, `n` re-lights; `:n` shows E492; `:noh extra` shows E488; Esc mid-typing restores normal mode; `3` then `:` drops the count.
- [ ] Terminal-only feel (key repeat, paint latency) is not verifiable via unit tests or tmux.

## Review focus

- Empty Enter must exit silently, not error (the none branch).
- Content typed after the prompt may itself contain `:` and digits (`:e ::5` someday); only Enter/Esc are special keys.
- `searchHL` must not leak across drafts/files: it is viewer state per card, reset semantics covered in Task 2 tests.
- E-code messages must ride the existing transient timer, not persist on the row.
- Address parity with `7G` is the regression that matters most: both paths must share `moved()`, not re-implement clamping.

## Verification

`npm test` and `npx tsc --noEmit` green after every task; manual E2E above before declaring done.
