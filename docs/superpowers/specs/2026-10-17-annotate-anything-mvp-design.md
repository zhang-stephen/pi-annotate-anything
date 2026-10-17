---
status: done
---

# pi-annotate-anything MVP Design

Date: 2026-10-17

## 1. Problem

Pi has no way to annotate an arbitrary range of an arbitrary local file and send that annotation to the agent. Existing solutions only cover transcript text (pi-copy-mode) or diffs (pi-diff-comment). This extension fills the gap: select any line/character range of any file on disk, attach a comment, and send it as part of a normal user message.

Primary scenario: plan/code review. The user inspects a file (often while the agent is busy), marks several ranges, writes a comment per range, and sends them all in one message.

## 2. Decisions (from brainstorming)

| Area | Decision | Rationale |
|---|---|---|
| Interaction | `/annotate <path>` opens an overlay card; no line numbers in the command | User picks the range visually |
| Card surface | `ctx.ui.custom(..., { overlay: true })`, auto-sized floating card | Lighter than fullscreen; pi supports overlay options natively |
| Selection | vim-like visual mode: `v` char-wise, `V` line-wise, `hjkl`/arrows move; `v`/`V` toggle off or switch mode, `o` swaps anchor/cursor, no block mode | User requirement; char + line share one data model |
| Selection rendering | Active selection: inverse/accent highlight (theme-driven). Pending annotations: a distinct theme color | User requirement; the two states must be visually distinguishable |
| File rendering | Plain source text plus syntax highlighting via pi's official `highlightCode()` / `getLanguageFromPath()` (theme-driven). Highlighting changes colors only, never text or width, so selection geometry stays exact. No markdown reflow rendering | User requirement; coordinate fidelity first |
| Comment input | Multi-line editor inside the card; Enter submits, ctrl+j / shift+enter inserts newline | User requirement |
| Card exit | Esc / q, layered: Esc cancels an active selection or comment first; otherwise Esc or q closes the card | User requirement |
| Card lifecycle | Card stays open after a comment submit, ready for the next selection; sending always happens from the composer, never from the card | Multi-annotation review flow; single send path avoids transform divergence |
| Reopened card | Renders pending (unsent) annotations from the store; markers disappear when the pill is deleted or the message is sent (`message_start`) | Store is the single source of truth; composer, status line, and card stay consistent. Sent annotations are not kept (future: annotation history) |
| Payload | Full snapshot: quote block with the selected text + comment (option A) | Fidelity to what the user saw; matches plannotator (`selectedText` + `lineStart/lineEnd`) and Claude Code; drift becomes detectable instead of silently re-pointing the comment |
| Delivery | Pill draft in the composer (copy-mode style); goes out with the user's message | User requirement |
| Pill visuals | Custom editor renders tokens as colored pills. The token IS the label (`[a.ts:10-20]`); rendering only recolors it, never changes width | Zero cursor-geometry risk; degrades gracefully to readable plain text |
| Dependencies | Pi-official APIs only: `CustomEditor` from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`. No third-party plugin libraries (no pi-libtui) | User requirement |
| Coexistence | Not handled: the custom editor is installed unconditionally | User decision; conflicts with pi-copy-mode's editor are accepted |
| Message transform | `pi.on("input")` expands tokens into the full payload | Same pattern as pi-copy-mode's envelope |
| Test runner | Node built-in `node --test` (node v26 runs TS directly) | bun is not installed; zero extra dependencies |

## 3. User flows

### 3.1 Annotating

1. User runs `/annotate src/a.ts`.
2. An overlay card opens showing the file with line numbers, centered over the chat. Viewport scrolls as needed.
3. User moves the cursor (`hjkl`, arrows, `gg`, `G`, `0`, `$`, `ctrl+d`/ `ctrl+u` half-page, PgUp/PgDn). The cursor clamps to the last column of the current line (vim default): `l` at end of line does not wrap to the next line; use `j`/`k` to change lines.
4. User presses `v` (char-wise) or `V` (line-wise) to start a selection, moves to extend it; `o` swaps the anchor and cursor ends (to adjust the other end), pressing `v` in char-wise mode exits to normal mode, pressing `V` switches to line-wise (and vice versa). The selected range is highlighted with an inverse/accent style. Esc cancels the selection.
5. Ranges that already have a pending annotation are rendered in a distinct theme color (different from the active selection highlight).
6. User presses `c` to comment. A multi-line editor appears at the bottom of the card. Enter submits; ctrl+j / shift+enter inserts a newline; Esc cancels.
7. On submit, the pill is inserted into the composer, e.g. `[a.ts:10-20]`, rendered in an accent color. The card STAYS OPEN: the cursor returns to the file and the user can immediately start the next selection. When done, the user closes the card (Esc or q) and composes prose around the pills in the composer. Sending always happens from the composer, never from inside the card (a single send path avoids transform divergence).
8. Esc or q (with no active selection/comment) closes the card without creating an annotation. Closing and reopening is lossless: pending annotations are rendered from the store.

### 3.2 Sending

1. User submits the message as usual.
2. The extension's `input` handler replaces every known token with its full payload and returns `{ action: "transform", text }`.
3. The agent receives one message containing the user's prose plus, per annotation, a block of the form:

       In `src/a.ts` (lines 10:5-12:20):
       ```ts
       <selected text, exact snapshot>
       ``` Comment: <user comment>

   Line-wise selections render as `(lines 10-20)`.
4. `message_start` prunes drafts whose tokens are no longer in the composer (after the user's own send, the composer is empty, so all drafts go; an unrelated RPC/extension-sent message keeps drafts whose pills remain). Card markers vanish accordingly.

## 4. Architecture

Single extension directory, no build step (jiti). Planned modules:

| File | Responsibility |
|---|---|
| `index.ts` | Default export `function (pi: ExtensionAPI)`; registers `/annotate`, wires session lifecycle |
| `src/viewer.ts` | Overlay card component: file rendering, line numbers, scrolling, cursor, visual selection, pending-annotation markers, key handling |
| `src/comment-input.ts` | Embedded multi-line comment editor inside the card |
| `src/selection.ts` | Pure: normalize anchor/cursor into `{ startLine, startCol, endLine, endCol }`; char vs line mode |
| `src/file-range.ts` | Pure-ish: read file (UTF-8, CRLF normalization, binary/size guards), extract exact range text |
| `src/message.ts` | Pure: format the payload (quote block + comment) |
| `src/store.ts` | Draft store: token -> { path, range, comment, snapshot }; orphan cleanup |
| `src/editor.ts` | Custom composer editor extending pi's `CustomEditor`; recolors known tokens as pills after `super.render()` |
| `src/transform.ts` | `input` event handler: expand tokens, `{ action: "transform" }` |

Data flow: viewer -> selection + file-range -> message -> store (token, snapshot) -> pasteToEditor(token) -> custom editor recolors token -> input transform expands -> message_start clears store.

## 5. Key mechanics

### 5.1 Token format

The token is a human-readable label and the store key in one:

```text
[a.ts:10-20]
```

Built from the path (relative to cwd when possible, basename-heavy when long) plus the range. If the identical label is already taken, a suffix disambiguates (`[a.ts:10-20 ~2]`). Inserted via `ctx.ui.pasteToEditor()`. Because the token is short, it stays in the composer as plain text; the custom editor recolors it (section 5.2). The composer text is the source of truth for draft survival: drafts whose token no longer appears in the composer are pruned at every trigger point (editor text change, card open via `getEditorText()`, before expansion on each `input` event, and on `message_start`). Clearing the composer therefore clears all unsent drafts.

### 5.2 Custom editor (pill rendering)

- Extends `CustomEditor` from `@earendil-works/pi-coding-agent` (pi's official extensible editor base).
- Overrides `render(width)`: calls `super.render(width)`, then recolors every known token substring in the returned lines with an accent style. The replacement has exactly the same visible width as the token, so cursor geometry, word wrap, and scrolling are unaffected.
- If the recolor ever fails to match (unexpected wrap, partial edit), the token simply remains readable plain text: graceful degradation by design.
- Installed at `session_start` via the editor-component factory. No coexistence handling (accepted risk).
- Drafts survive pi's synchronous editor-clear on submit via the store and are cleared at `message_start` (copy-mode's proven pattern).

### 5.3 Selection and annotation rendering in the card

- File content renders as source text with line numbers, syntax highlighted via pi's exported `highlightCode(code, getLanguageFromPath(path))`. The highlight pass only adds ANSI color; all selection geometry is computed on the raw text, so columns stay exact. No markdown reflow rendering: `.md` files show their source.
- Active selection: inverse/accent highlight (theme color), including the line-number gutter for line-wise mode.
- Pending annotations: a different theme color, subtler than the active selection (e.g. muted background plus a gutter marker).
- All width math via pi-tui `visibleWidth()` / `truncateToWidth()` (tabs, wide glyphs).

### 5.4 File guards

- Path expansion: `~`, relative to session cwd; must be an existing file (not a directory).
- UTF-8 decode; reject files containing NUL bytes as binary.
- Size guard: refuse files larger than a configurable cap (default 1 MB).
- CRLF normalized to LF for selection math; the snapshot uses normalized text.

## 6. Edge cases

- Reversed selections (select bottom-up) normalize automatically.
- Empty file / empty comment: empty comment is allowed (annotation without comment text); empty file opens a card stating the file is empty.
- File changed on disk between annotate and send: by design; the snapshot is the payload, and the agent may re-read the file to compare.
- Agent busy: message delivery follows pi's normal queue (the user composes, pi queues); nothing extension-specific.
- Multiple annotations of the same file/range: allowed; each gets its own token (disambiguated) and payload.
- Overlapping pending annotations in the card: both markers render; overlap regions use the pending-annotation style.

## 7. Testing

Runner: Node built-in test runner (`node --test`), TypeScript via native type stripping. No test dependencies.

| Layer | Tests |
|---|---|
| `selection.ts` | Normalize forward/backward, char vs line mode, clamping at file bounds |
| `file-range.ts` | Exact extraction of line ranges, char ranges, mid-line spans, CRLF input, tabs, wide chars, empty file, binary rejection, size cap |
| `message.ts` | Payload format for line-wise, char-wise, no-comment, special chars in path |
| `store.ts` + `transform.ts` | Token issuance and disambiguation, expansion round-trip, orphan pruning, multiple tokens, token-like text the user typed manually must not expand |
| `editor.ts` | Token recolor preserves line width; unknown text untouched |
| Manual e2e | `pi --extension ./index.ts`: open card, select, comment, pill appears, reopen card shows marker, send, verify agent-visible text |

## 8. Out of scope (future)

Next-phase candidates (post-MVP, timing TBD):

- Rendered-markdown annotation mode, likely behind an explicit option/toggle. The payload format already tolerates missing coordinates, so a preview mode can mark itself as a rendered-view annotation without a protocol change.
- Transcript annotation (annotating rendered conversation content). Overlaps with pi-copy-mode today; fold into this extension in a later phase, timing as decided.

Deferred indefinitely:

- Block-wise selection (ctrl+v).
- Word motions (`w`/`b`/`e`) and search (`/`).
- Editing an existing pill's comment (delete and redo for now).
- Annotation history (persisting sent annotations in the card).
- Status-line summary of pending annotations (low priority; the composer pills and the card markers already show the same state).
- Coexistence with other extensions' custom editors.
- "Annotate + ask agent to modify" combined mode.
