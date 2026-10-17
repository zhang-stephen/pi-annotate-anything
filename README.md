# pi-annotate-anything

A [Pi](https://github.com/earendil-works/pi-coding-agent) coding agent extension for annotating arbitrary line/character ranges of any local file. Annotations are injected into the conversation as a quote block plus comment.

Open any file in an overlay viewer, select a range the way vim does, attach a comment, and send it to the agent as part of a normal message. Built for plan and code review: mark several ranges while the agent is busy, then send them all in one message.

## How it works

1. `/annotate <path>` opens an overlay card showing the file with line numbers and syntax highlighting.
2. You select a range in visual mode and press `c` to write a comment.
3. On submit, a short pill token such as `[src/a.ts:10-20]` is inserted into the composer. The card stays open for the next annotation.
4. When you send your message, every pill is expanded into a full payload containing an exact snapshot of the selected text plus your comment.

The payload carries the text you saw at annotate time, not a re-read of the file, so agent-visible content never silently drifts.

## Install

This is a Pi extension package (`pi-package`). Install it with npm as you would any package, or run it directly from source during development:

```sh
pi --extension /path/to/pi-annotate-anything
```

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
| `c` | Visual mode: comment the selection. Normal mode on a line with a pending annotation: edit its comment (pre-filled) |
| `x` | Delete the pending annotation under the cursor (normal mode); also removes its pill from the composer |
| `p` | Toggle the hover preview of pending comments (normal mode) |
| `Esc` | Cancel the selection or comment box; otherwise close the card |
| `q` | Close the card (normal mode only) |

The card is a bordered panel: the title bar shows the file path and live pending count, and the footer shows a vim-style mode badge (`-- VISUAL --`, `-- VISUAL LINE --`, `-- COMMENT --`) plus the keys available in that mode. In normal mode, resting the cursor on a line with a pending annotation shows a read-only preview of its comment; press `c` to edit it in place.

The cursor clamps to the last column of the current line: `l` at the end of a line does not wrap to the next line. Reversed selections (bottom-up) are normalized automatically.

### Keys: comment box

| Key | Action |
| --- | --- |
| `Enter` | Submit the annotation |
| `ctrl+j` or `shift+enter` | Insert a newline |
| `Esc` | Cancel and return to the selection |

The comment box is a floating panel that opens next to the selection (below it, or above when space runs out).

## Payload format

A pill in the composer looks like `[src/a.ts:10-20]`. When the message is sent, it is expanded to:

````text
In `src/a.ts` (lines 10-20):
```ts export function greet(name: string) { return `Hello, ${name}`; }
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
- Pending (unsent) annotations render as theme-colored gutter markers and underlines; resting the cursor on one previews its comment.
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

## License

MIT. See [LICENSE](LICENSE).
