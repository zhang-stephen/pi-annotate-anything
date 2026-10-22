---
title: Viewer Command Line (:) - Design
status: approved
plan: ../plans/2026-10-22-viewer-command-line.md
---

# Viewer Command Line (:) - Design

Date: 2026-10-22

## Problem

The card's modal vocabulary ends at what single keys and two-stroke sequences can express, and the cmdline row (built for the `/` search input) has an input variant that was reserved for `:` commands but never wired up.
With buffers on the roadmap, commands like `:ls`, `:b 2`, and `:e file` will need a home that scales beyond another per-key special case.

## Approach

A new `command` viewer mode, entered by `:` from normal mode, editing one line of text with exactly the semantics the search input already has, executed on Enter against a pure command table.
The grammar is deliberately tiny -- a bare numeric address or a word with optional arguments -- but the parsing, prefix resolution, and error reporting are generic, so future commands are table entries, not framework changes.

## Mode

- `:` in normal mode enters `command` mode (`state.command = { value: "" }`); any pending count is dropped, same as `/` entry.
- From visual, comment, and search modes `:` does nothing in v1 (vim's `:'<,'>` range prefill is deferred together with ranges generally).
- Editing mirrors searchStep except where amended: printable chunks append whole (pastes included), Backspace pops one code unit, ~~a no-op at the empty value, not an exit~~ at the empty value it exits to normal mode like Esc (amended 2026-10-22 after E2E: the user wants a keyboard-only exit path; vim's no-op-at-start behavior yields to daily-driver comfort), Esc cancels back to normal mode, Enter executes, and newline-shaped or control keys are ignored.
- The cursor never moves while editing (no incremental jumps), so there is no origin to remember: Esc simply restores normal mode.
- Execution always ends command mode; success, error, and empty input alike return to normal mode.
- Rendering: a `-- COMMAND --` badge, empty hints text (the cmdline row shows the input itself), and the `:` prompt through the existing `{ kind: "input" }` cmdline variant.

## Grammar

After trimming, the whole line is either an address or a command; nothing else parses.

- `none` -- the empty line; Enter exits silently.
- `address` -- `^\d+$`; jumps to that 1-based line with exactly `{count}G` semantics (column preserved, line clamped into the file, viewport follows).
- `command` -- whitespace-split into a name and argument tokens.

A command name may carry one trailing `!`, stripped before resolution (`:q!` resolves as `quit`; a second bang is part of the name and fails as E492).
Name resolution: an input matches a table entry when the entry's full name starts with the input and the input is at least the entry's `short` form (vim's shortest-abbreviation model, so `:n` is not `nohlsearch`); exactly one match executes, zero matches reports `E492: Not an editor command: <name>`, and two or more report `E464: Ambiguous command`.
Matching is case-sensitive, like vim.
All v1 commands declare `args: "none"`; any argument tokens report `E488: Trailing characters`.
Errors surface through the existing transient cmdline message mechanism and are the only output of a failed command.

## Command table

New pure module `src/viewer/commands.ts`, no I/O and no pi imports:

```ts
interface CommandSpec {
  name: string; // full canonical name ("nohlsearch")
  short: string; // shortest accepted abbreviation ("noh"); shorter inputs are E492
  args: "none"; // v1 only; future: "number" | "restOfLine"
  run(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerResult;
}
function parseCommandLine(raw: string): Parsed | CmdError;
function resolveCommand(name: string): CommandSpec | "not-found" | "ambiguous";
function executeCommand(state: ViewerState, raw: string, lines: string[], viewport: ViewerViewport): ViewerResult;
```

v1 table:

- `quit` (short `q`) -- emits the existing `close` effect. ~~no `!` variant (the card has no unsaved state).~~ Amended 2026-10-22 after E2E: a single trailing bang on a command name is stripped and silently ignored, so `:q!` runs `quit`; there is nothing to force, so the bang is a no-op kept purely for muscle-memory compatibility.
- `nohlsearch` (short `noh`) -- turns off search highlighting without clearing `lastSearch`.

`:nohlsearch` semantics (vim-faithful): highlight and the `[rank/total]` statusline segment are currently driven at render time by `lastSearch`; the command sets a new `state.searchHL = false` flag that suppresses both, while `n`/`N` repeats and a new `/` submission set it back to true.
The pattern stays available for repeats, exactly like vim's `:noh`.

## Completion

One presentation surface for every completion source: a candidate drawer rendered above the footer, at the bottom of the file view, transiently overlaying body lines.
~~An incremental panel that appears from the first typed character and filters live while typing, with the interaction model the composer's path completion already uses.~~ Amended 2026-10-22 after live E2E: the drawer follows vim's wildchar instead -- it exists only while Tab-cycling and typing never pops anything, which ends the per-keystroke open/filter churn and keeps the card's vim muscle memory in one piece.

- Bare `:` shows nothing, and Tab with an empty value or no candidates is inert; the drawer opens as a whole on the first Tab with candidates.
- First Tab snapshots the candidate list from the current value (the anchor) and accepts the first candidate into the value; further Tabs advance the selection (wrapping) and write the selected name; any other key -- typing, Backspace, Enter, Esc -- closes the drawer, the value keeping whatever was accepted.
- The cmdline value stays literal -- the drawer is a suggestion display, never a second input.
- Source switching follows the grammar state: a bare word completes against the command table (prefix match; completing inserts the full name, so an accepted candidate is always executable under the short-bound rule); a command name plus whitespace asks that command's `complete` hook for candidates -- no v1 command has one, so there is nothing to cycle; empty input and no-match make Tab inert.
- Enter always executes the literal cmdline value; Esc exits command mode (the drawer dies with it; there is no two-stage Esc); Backspace pops and closes the drawer.
- Matching strategy belongs to the source, not the drawer: prefix for command names, fuzzy for the future `:e` file source.
- Presentation: the drawer is fully enclosed -- a top rule broken by the source's label (` completions ` today; future sources name themselves, e.g. ` paths `), the candidate rows, and a plain closing rule beneath; narrow widths drop the count first, then the label, degrading to plain rules, and the enclosed drawer covers at most 7 body lines (top rule + 5 rows + closing rule).
- Colors, four tiers only: rules, label, descriptions, and the cycling count (`2/4` of the capped window, top rule right end) are dim chrome -- ~~the label renders accent, echoing the badge~~ amended 2026-10-22 after live E2E: the accent tier is reserved for the mode badge alone, since a label-plus-badge stack read as two competing mode markers -- candidate names default, and the selected row inverted like the cmdline cursor cell; colors stay injected.

## Out of scope (with reasons)

- `:w` / `:wq` -- the card writes nothing; submission is comment mode's Enter, and aliasing "write" onto it would be a lie.
- `:set` -- nothing configurable yet (no line numbers, no wrap); the first real option is what adds argument parsing.
- Ranges (`:{a},{b}`) and address-prefixed commands (`:5q`) -- no command consumes a range yet; the grammar grows them when one does.
- `:'<,'>` from visual mode -- follows ranges.
- Command history (up/down recall) and the command-line window -- non-goals; the cmdline is one line.
- Vim's full abbreviation rules -- unambiguous-prefix is the honest subset, and full names always work.

## Extension notes (non-normative)

- Buffer roadmap: `:ls`, `:b {n}` (`args: "number"`), and `:e {file}` (`args: "restOfLine"`) land as table entries plus new effect kinds for the shell to interpret; `:e` attaches the fuzzy path source (`completePath`) through the `complete` hook and renders in the same unified panel; the framework does not change.
- Argument policies diverge by design (`:b` takes a token, `:e` takes the rest of the line including spaces), which is why the policy hangs off the CommandSpec.
- Prefix bounds are part of each command's contract (`nohlsearch` accepts `noh` and longer, never `:n`), so new commands pick their shortest form deliberately; full names always work.

## Testing

- `test/viewer/commands.test.ts` (new): parser (none/address/command/trailing text), resolver (exact, prefix within short bounds, too-short E492, not-found, ambiguous), executors (close effect, searchHL flag, address jump parity with `{count}G`).
- `test/viewer/state.test.ts` additions: mode entry drops the count, edit/cancel/execute transitions, `:` inert in non-normal modes, error messages set on E492/E488/E464.
- `test/viewer/status-line.test.ts` additions: `-- COMMAND --` badge, `:` prompt input rendering.
- Manual E2E: typed commands, backspace at empty, Esc mid-typing, error display, `:noh` against a live highlight.
