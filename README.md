# pi-annotate-anything

[![npm version](https://img.shields.io/npm/v/pi-annotate-anything)](https://www.npmjs.com/package/pi-annotate-anything)
[![ci](https://github.com/zhang-stephen/pi-annotate-anything/actions/workflows/ci.yml/badge.svg)](https://github.com/zhang-stephen/pi-annotate-anything/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-annotate-anything)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-coding-agent) coding agent extension for annotating arbitrary line/character ranges of any local file, injected into the conversation as a quote block plus comment.

## Highlights

- **Vim-like modal interaction.** The annotation card is a modal viewer; if your fingers know vim, they already know this card:
  - normal / visual / comment modes, char-wise and line-wise selection with `o` to swap endpoints
  - motions: `h j k l`, `0` `$`, `gg` `G`, half/full page jumps, `{count}` prefixes shown as you type
  - `/` search: regex + smartcase, incremental jump as you type, persistent highlight, `n`/`N` to hop between matches
  - `:` command line: `:q`, `:noh`, line addresses, and a Tab-triggered completion drawer
  - `Tab` cycling when annotations stack at the cursor
- **Annotate anything.** Any local file, not just code: source, logs, configs, docs, data. Any range, down to character precision. Each annotation becomes a pill in the composer and ships to the agent as an exact annotate-time snapshot plus your comment.

## Demo

<!-- TODO: terminal recording (asciinema / vhs) of /annotate in action -->

## Install

```sh
pi install npm:pi-annotate-anything
```

**Requirements**: a terminal font with Nerd Font Mono glyphs (used for the pending-annotation gutter icon). Without one the icon degrades to a placeholder box; everything else works the same.

## Features

- Overlay card with line numbers, syntax highlighting, a live pending-count title bar, and a vim-style mode badge footer.
- Vim-style `/` search in the viewer: regex + smartcase (case-insensitive unless the pattern has an uppercase letter), jumps to the nearest match as you type, all matches stay highlighted after submit, `n`/`N` hop with wrap messages, `{count}` prefixes work on motions and hops, and backspace at the empty prompt exits like `Esc`.
- `:` command line in the viewer: `quit` (`:q`) closes the card, `nohlsearch` (`:noh`) clears the search highlight while `n`/`N` keep working, and a bare number (`:7`) jumps like `7G`; a single trailing `!` is ignored (`:q!`), prefixes resolve down to each command's short form (`:noh`, never `:n`), and unknown or malformed input reports vim-style errors (`E492`, `E464`, `E488`).
- Command completion behind Tab: an enclosed drawer (labeled divider with the cycling count, dim descriptions, closing rule) opens on Tab with the matching commands, further Tabs cycle the selection, and typing closes it keeping the accepted value; this drawer is the surface future sources (paths for `:e`, buffers) plug into.
- Pending keys render right-aligned in the cmdline row (showcmd): a pending count or the `g` of `gg` stays visible until the sequence lands.
- Cmdline and search carets render as the terminal's hardware cursor: the `:` and `/` inputs emit the same marker contract as the comment box, so caret style follows the terminal everywhere.
- The goal column survives short lines (curswant): vertical moves keep aiming at the column you came from; horizontal moves, jumps, searches, and mode switches end the session.
- Fuzzy path completion in the `/annotate` argument: session-relative paths, `~` expansion, directories first, and workspace-wide fuzzy matching backed by an async file index. Recommended host: pi >= 1.0 (older hosts report an explicit error and get no completion).
- Composer pills like `[src/a.ts:10-20]` that expand into full quote-block-plus-comment payloads when the message is sent. `alt+o` in the composer jumps back: it opens the viewer centered on the last pill's range with every pending comment of that file replayed, ready for `c` (edit) or `x` (delete); with no pills it warns that there is nothing to jump back to.
- Annotate-time snapshots: the payload carries the text you saw when annotating, never a silent re-read of the file.
- Floating comment editor next to the selection with soft wrap and multiline support (`ctrl+j` / `shift+enter`), a movable caret (`Left`/`Right` by grapheme, `Up`/`Down` across wrapped rows with a goal column, `Home`/`End` to row edges), and hardware-cursor rendering: the caret follows the terminal's own cursor style, falling back to an inverse cell when the TUI hides hardware cursors.
- Pending ranges marked with underlines plus a gutter marker (Nerd Font icon + count on each draft's start line, continuation lines get a dim bar).
- Stacked annotations: when several pending drafts cover the cursor, `Tab` cycles the target; preview, edit (`c`), and delete (`x`) act on the target.
- Hover preview of the comment under the cursor (`p` toggles it).
- The card stays open after each annotation: mark many ranges in one pass, then send them all in one message.

## Usage

```
/annotate <path>
```

`<path>` supports `~` expansion, Tab-completion, and is resolved relative to the session working directory. It must be an existing regular file. The viewer refuses directories, binary files (files containing NUL bytes), and files larger than 1 MB. CRLF line endings are normalized to LF.

### Keys

Every key is listed per mode; `-` means the key does nothing in that mode. The search `/` column applies while the search prompt is open, the command `:` column while the command line is open, the comment box column while the floating comment editor is open.

| Key | Normal | Visual | Search `/` | Command `:` | Comment box |
| --- | --- | --- | --- | --- | --- |
| `h` `j` `k` `l` / arrows | move the cursor | expand / shrink the selection | - | - | - |
| `0` / `$` | start / end of the line | same, keeping the anchor | - | - | - |
| `gg` / `G` | first / last line; `{count}G` jumps to line N | same, keeping the anchor | - | - | - |
| `ctrl+d` `ctrl+u` / `PgDn` `PgUp` | half / full page | same | - | - | - |
| `1`-`9` (then digits) | count prefix for `j` `k` `h` `l` `G` `n` `N`, shown in the cmdline row until the motion lands | - | - | - | - |
| `/` | enter search mode | - | - | - | - |
| `n` / `N` | next / previous match (wraps, with a message) | same | - | - | - |
| `:` | enter command mode | - | - | - | - |
| printable text | - | - | append to the pattern; the match jumps as you type | append to the command line | insert |
| `Backspace` | - | - | delete the last pattern char; at empty, exit to normal | delete the last char; at empty, exit to normal | delete the grapheme before the caret |
| `arrows` / `Home` `End` | - | - | - | - | move the caret: `Left`/`Right` one grapheme, `Up`/`Down` one wrapped row (goal column kept), `Home`/`End` to the row edges |
| `Enter` | - | - | submit (empty pattern repeats the last search) | execute the command line (empty exits silently) | submit the annotation |
| `ctrl+j` / `shift+enter` | - | - | - | - | insert a newline |
| `v` / `V` | enter visual char / line mode | switch mode, or exit to normal | - | - | - |
| `o` | - | swap the anchor and cursor ends | - | - | - |
| `Tab` | cycle the target among stacked pending annotations | - | - | complete the command name; cycle the candidates | - |
| `c` | edit the targeted annotation's comment (pre-filled) | comment the selection | - | - | - |
| `x` | delete the targeted annotation (and its pill) | - | - | - | - |
| `p` | toggle the hover preview of pending comments | - | - | - | - |
| `Esc` | - | exit to normal mode | cancel; the cursor returns to where `/` started | cancel; back to normal | cancel the edit |

`q` is unmapped: `:q` is the only way to close the card.

The comment box is a floating panel that opens next to the selection (below it, or above when space runs out).

### Differences from vim

The viewer borrows vim's grammar, not its job: it annotates instead of editing. Where behavior diverges:

- **Keys are repurposed for annotation, not editing**: `c` comments (not change), `x` deletes the annotation at the cursor (not a character), `p` previews the annotation (not paste), `o` swaps selection endpoints in visual mode (not open-line), `Tab` cycles stacked annotation targets (not a vim binding).
- `Esc` backs out one level wherever you are: comment box -> cancel the edit, search -> cancel and restore the cursor, visual -> normal; in normal mode it is an explicit no-op -- `:q` is the only close.
- Selections start **empty** at the cursor and expand/shrink per keypress; vim grows the selection from the entry cell instead.
- `{count}` is accepted only in normal mode and only before `j` `k` `h` `l` `G` `n` `N`.
- Search uses **JavaScript regex + smartcase** (case-insensitive unless the pattern contains an uppercase letter), not vim's regex dialect; no `\c` `\v` magic, no `*` `#` `f` `t` `%` motions, no operators.
- The command line is a **curated subset**: `:q`, `:noh`, and line addresses, with unambiguous-prefix resolution down to each command's short form; a single trailing `!` is ignored (`:q!`); and `gg` ignores `{count}` (vim's `3gg` goes to line 3).

### Stacked annotations and the gutter

Pending annotations render as underlined ranges. The gutter before each line shows a marker field of fixed width:

- On a draft's start line: the comment icon plus the number of drafts starting there (warning color, `+` above 9).
- On lines a draft merely passes through: a dim vertical bar.
- The sum of all gutter counts always equals the pending count in the title bar.

When the cursor sits on a position covered by several pending drafts, exactly one is the target: its range renders bold and warning-colored, overlapping non-targets go dim, and the preview box shows its comment with a `(i/n)` position indicator. Press `Tab` to cycle the target (newest first, wrapping); moving the cursor resets the cycle.

## Payload format

A pill in the composer looks like `[src/a.ts:10-20]`. When the message is sent, it is expanded to:

````text
In `src/a.ts` (lines 10-20):
```ts
export function greet(name: string) { return `Hello, ${name}`; }
```
Comment: this name is misleading, rename it?
````

Label variants:

- `[src/a.ts:10-20]` - line-wise range
- `[src/a.ts:10]` - single line
- `[src/a.ts:10:5-12:20]` - char-wise range (1-based line:column)
- `[src/a.ts:10-20 ~2]` - suffix added when the identical label is already pending in the composer

## Behavior notes

- The card stays open after submitting an annotation so you can mark several ranges in one pass. Close it with `:q`, then compose prose around the pills in the composer (or `alt+o` back to the last pill's location). Sending always happens from the composer.
- An empty comment is allowed: the annotation is sent without a `Comment:` line.
- Deleting a pill from the composer deletes that annotation; its markers disappear from the card.
- Sending the message expands every remaining pill into its payload and clears them.
- Multiple annotations of the same range are allowed; each gets its own disambiguated token.
- The composer editor wrapper is registered once per session and never swapped: it chains whatever editor factory was configured when the session started, so user-configured editors keep working underneath; recoloring and the `alt+o` jump apply only while pills are live.

## Roadmap

- **Buffers**: annotate and navigate multiple sources in a single card session.
- **More vim**: a limited, curated set of additional vim commands (motions and operators that fit the annotation workflow).
- **Basic Markdown rendering**: render `.md` files with basic formatting (headings, emphasis, lists, code blocks) in the viewer instead of raw text.

## Development

No build step: Pi bundles jiti and runs the TypeScript source directly.

```sh
npm install
npm test
npm run typecheck
```

Run the extension from source:

```sh
pi --extension ./index.ts
```

### Release

Versions, changelogs, and npm publishing are automated: [release-please](https://github.com/googleapis/release-please) opens a release PR from Conventional Commits, and merging it tags the release and publishes to npm via trusted publishing (OIDC). Never bump `package.json` or edit `CHANGELOG.md` by hand.

## License

MIT. See [LICENSE](LICENSE).
