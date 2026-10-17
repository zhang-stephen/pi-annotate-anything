# pi-annotate-anything

[![npm version](https://img.shields.io/npm/v/pi-annotate-anything)](https://www.npmjs.com/package/pi-annotate-anything)
[![ci](https://github.com/zhang-stephen/pi-annotate-anything/actions/workflows/ci.yml/badge.svg)](https://github.com/zhang-stephen/pi-annotate-anything/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pi-annotate-anything)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-coding-agent) coding agent extension for annotating arbitrary line/character ranges of any local file, injected into the conversation as a quote block plus comment.

## Highlights

- **Vim-like modal interaction.** The annotation card is a modal viewer with normal / visual / comment modes: `h j k l` movement, `v` / `V` char-wise and line-wise selection, `gg` / `G`, half-page jumps, `c` to comment, `x` to delete, `Esc` to back out. If your fingers know vim, they already know this card.
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
- Composer pills like `[src/a.ts:10-20]` that expand into full quote-block-plus-comment payloads when the message is sent.
- Annotate-time snapshots: the payload carries the text you saw when annotating, never a silent re-read of the file.
- Floating comment editor next to the selection with soft wrap and multiline support (`ctrl+j` / `shift+enter`).
- Pending ranges marked with underlines plus a gutter marker (Nerd Font icon + count on each draft's start line, continuation lines get a dim bar).
- Stacked annotations: when several pending drafts cover the cursor, `Tab` cycles the target; preview, edit (`c`), and delete (`x`) act on the target.
- Hover preview of the comment under the cursor (`p` toggles it).
- The card stays open after each annotation: mark many ranges in one pass, then send them all in one message.

## Usage

```
/annotate <path>
```

`<path>` supports `~` expansion and is resolved relative to the session working directory. It must be an existing regular file. The viewer refuses directories, binary files (files containing NUL bytes), and files larger than 1 MB. CRLF line endings are normalized to LF.

### Keys: file viewer

| Key | Action |
| --- | --- |
| `h` `j` `k` `l` or arrow keys | Move the cursor |
| `0` / `$` | Start / end of the current line |
| `gg` / `G` | Top / bottom of the file |
| `ctrl+d` / `ctrl+u` | Half page down / up |
| `PgDn` / `PgUp` | Page down / up |
| `v` | Start char-wise selection; in visual mode, switch to char-wise or exit |
| `V` | Start line-wise selection; in visual mode, switch to line-wise or exit |
| `o` | Swap the anchor and cursor ends (visual mode only) |
| `Tab` | Cycle the target among stacked pending annotations under the cursor (normal mode) |
| `c` | Visual mode: comment the selection. Normal mode: edit the targeted annotation's comment (pre-filled) |
| `x` | Delete the targeted pending annotation; also removes its pill from the composer |
| `p` | Toggle the hover preview of pending comments (normal mode) |
| `Esc` | Cancel the selection or comment box; otherwise close the card |
| `q` | Close the card (normal mode only) |

### Keys: comment box

| Key | Action |
| --- | --- |
| `Enter` | Submit the annotation |
| `ctrl+j` or `shift+enter` | Insert a newline |
| `Esc` | Cancel and return to the selection |

The comment box is a floating panel that opens next to the selection (below it, or above when space runs out).

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

- The card stays open after submitting an annotation so you can mark several ranges in one pass. Close it with `Esc` or `q`, then compose prose around the pills in the composer. Sending always happens from the composer.
- An empty comment is allowed: the annotation is sent without a `Comment:` line.
- Deleting a pill from the composer deletes that annotation; its markers disappear from the card.
- Sending the message expands every remaining pill into its payload and clears them.
- Multiple annotations of the same range are allowed; each gets its own disambiguated token.
- The custom composer editor is installed unconditionally and does not coexist with other extensions that install their own editor.

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
