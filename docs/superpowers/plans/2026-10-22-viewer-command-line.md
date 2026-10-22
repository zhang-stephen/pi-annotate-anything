---
title: Viewer command line (:) implementation plan
status: in-progress
progress: 1/5
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

- [ ] `ViewerMode` gains `"command"`; `ViewerState.command?: { value: string } | null`.
- [ ] Normal-mode `:` enters command mode and drops the count; `:` is inert in visual/comment/search modes.
- [ ] Editing mirrors `searchStep` exactly: printable chunks append whole; Backspace pops one code unit and is a no-op at empty (never exits); Esc returns to normal; Enter runs `executeCommand`; control/newline-shaped keys are ignored.
- [ ] `ViewerState.searchHL?: boolean` (undefined = true): `nohlsearch` sets false; `n`/`N` and `/` submission set it back to true.
- [ ] Tests: entry drops count; inert elsewhere; append/backspace/Esc/Enter transitions; quit surfaces the `close` effect; `:zzz` sets the E492 message; `:noh` then `n` re-lights (`searchHL` true again).
- [ ] Steps: failing tests first, implement, suite green, commit `feat(viewer): add command mode to the viewer reducer`.

## Task 3: rendering

Files: `src/viewer/status-line.ts`, `test/viewer/status-line.test.ts`

- [ ] `CardMode` gains `"command"`; badge `-- COMMAND --`; `FOOTER_HINTS` entry is the empty string.
- [ ] The cmdline renders through the existing `{ kind: "input", prompt: ":", value, cursorCol }` path in `renderCommandLine` (line ~159); no new renderer branch beyond the prompt character.
- [ ] Tests: badge text, `:` prompt with typed value and cursor position, empty hints.
- [ ] Steps: failing tests first, implement, suite green, commit `feat(viewer): render command mode badge and prompt`.

## Task 4: shell wiring

Files: `src/viewer/viewer.ts`, `test/viewer/viewer.test.ts`

- [ ] Render `state.command` as the cmdline input while command mode is active (the reducer handles keys; the shell only paints).
- [ ] Highlight suppression: when `searchHL === false`, the per-frame query resolution block (viewer.ts ~line 219) skips match spans and the `[rank/total]` statusline segment; `true`/undefined behavior unchanged.
- [ ] Tests: command input painted with `:` prompt; `searchHL: false` renders no highlight spans and no segment over a fixture with matches; toggling back restores both.
- [ ] Steps: failing tests first, implement, suite green, commit `feat(viewer): wire command mode painting and noh highlight suppression`.

## Task 5: manual E2E (user)

- [ ] Sandbox: `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts` with /tmp fixtures (long lines, CJK, CRLF).
- [ ] Cases: `:q` closes; `:7` jumps like `7G`; `/foo` then `:noh` clears highlight, `n` re-lights; `:n` shows E492; `:noh extra` shows E488; Backspace at empty stays put; Esc mid-typing restores normal mode; `3` then `:` drops the count.
- [ ] Terminal-only feel (key repeat, paint latency) is not verifiable via unit tests or tmux.

## Review focus

- Empty Enter must exit silently, not error (the none branch).
- Content typed after the prompt may itself contain `:` and digits (`:e ::5` someday); only Enter/Esc are special keys.
- `searchHL` must not leak across drafts/files: it is viewer state per card, reset semantics covered in Task 2 tests.
- E-code messages must ride the existing transient timer, not persist on the row.
- Address parity with `7G` is the regression that matters most: both paths must share `moved()`, not re-implement clamping.

## Verification

`npm test` and `npx tsc --noEmit` green after every task; manual E2E above before declaring done.
