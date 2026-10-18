---
title: /annotate Path Completion - Design
status: approved
---

# /annotate Path Completion - Design

Date: 2026-10-18

## Problem

`/annotate <path>` takes a file path as its only argument, but the composer offers no completion for it, so the path must be typed in full from memory.
Pi's command API supports this directly: `RegisteredCommand.getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<...>`, with `AutocompleteItem = { value: string; label: string; description?: string }` from pi-tui.

## Approach

Filesystem path completion wired into the existing `pi.registerCommand("annotate", { ... })` call, with the listing/filtering logic in a new testable helper module `src/path-completion.ts`:

```ts
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export function completePath(argumentPrefix: string, cwd: string): AutocompleteItem[] | null;
```

`getArgumentCompletions` on the command delegates to `completePath(prefix, ctx.cwd)`.

## Completion rules

- The prefix is split into a directory part and a base part at the last `/`; the directory part resolves with the same rules as `resolvePath` (`~` and `~/...` expand to the home directory, everything else resolves against `cwd`).
  An empty prefix lists the cwd.
- Entries in that directory whose name starts with the base part are returned, directories first, then files, each group sorted case-insensitively.
- Dotfiles are listed only when the base part itself starts with a `.` (shell convention).
- Directory items get a trailing `/` so completing a directory continues into it: `value` is the full argument text (directory part + name + `/`), `label` is the entry name with the same trailing marker, `description` is `"dir"`; file items carry no description.
- Results are capped at 100 entries; beyond that the list is truncated (alphabetically first entries win).
- An unreadable or nonexistent directory part returns `null` (no completions), matching the API's "no suggestions" signal.
- Synchronous `fs.readdirSync` per invocation: calls fire per keystroke, but directory reads at this scale are cheap; no caching layer (YAGNI).

## Testing

- `test/path-completion.test.ts` (new, tmp-dir fixtures): relative and absolute prefixes, `~/` expansion, directories first with trailing `/`, dotfile gating, base-part filtering, empty prefix lists cwd, unreadable/missing directory returns `null`, result cap.

## Explicitly out of scope

- Paths containing spaces: the command argument is parsed with `args.trim()` today, so quoting/escaping is unsupported and completion does not attempt it.
- Completing anything beyond the single path argument (there are no further arguments).
- Fuzzy matching; prefix matching only, mirroring shell tab completion.
