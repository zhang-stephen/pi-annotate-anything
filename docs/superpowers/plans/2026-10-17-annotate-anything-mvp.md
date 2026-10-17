# pi-annotate-anything MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-zh's
> subagent-driven-development (recommended) or executing-plans to implement
> this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pi extension that annotates arbitrary line/character ranges of
any local file via `/annotate <path>`, collecting annotations as labeled
composer pills that expand into full snapshot payloads on send.

**Architecture:** Overlay card (`ctx.ui.custom` + `overlayOptions`) with
vim-like selection over syntax-highlighted source; annotations stored in a
draft store keyed by human-readable tokens (`[a.ts:10-20]`); tokens inserted
into the composer via `ctx.ui.pasteToEditor`; a `CustomEditor` subclass
recolors tokens as pills; an `input` event handler expands tokens into quote
blocks + comments; `message_start` clears the store.

**Spec:** `docs/superpowers/specs/2026-10-17-annotate-anything-mvp-design.md`
(approved; it holds user-flow and rendering decisions, this plan holds file
paths and commands).

**Tech stack:** TypeScript (no build step, pi's jiti loads `.ts` directly),
`@earendil-works/pi-coding-agent` 1.3.0 + `@earendil-works/pi-tui` 1.3.0
(pi-official APIs only, both as `peerDependencies: "*"`, pinned in
`devDependencies` for types), Node built-in test runner (`node --test`,
native type stripping on Node >= 22.18), `tsc --noEmit` for typechecking.

**Global constraints (apply to every task):**

- English for all code, comments, tests, docs. Chinese only where AGENTS.md
  allows.
- ASCII only in all files, except UI-facing strings which may use Nerd Font
  icons.
- Semantic commits, e.g. `feat(viewer): ...`.
- No third-party libraries beyond `@earendil-works/*`.
- Run tests with `node --test test/` and typecheck with `npx tsc --noEmit`.
- Update this plan's checkboxes AND `docs/superpowers/STATUS.md` in the same
  commit that finishes a task.

**Review Focus (high-risk points, check carefully in review):**

1. Token collision: user-typed text that looks like a token must never
   expand (transform only expands tokens present in the store).
2. Pill recolor must not change line width: replacement is color-only, the
   token text itself is the pill label (cursor geometry risk if violated).
3. Wide chars/tabs: selection math on raw columns, display math via
   `visibleWidth()`; tab expansion mapping helper must be tested.
4. CRLF and binary/size guards in file loading.
5. Draft lifecycle: the composer text is the source of truth for draft
   survival. `pruneFromText(editorText)` runs at every trigger point:
   editor text change, card open, before transform on `input`, and on
   `message_start` (no blind `clear()` -- a message_start from an
   RPC/extension-sent message must not kill drafts whose pills are still in
   the composer). Store is dropped at session shutdown.

---

### Task 1: Project scaffold

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `test/smoke.test.ts`

- [x] **Step 1: Install dev dependencies**

```bash
npm install --save-dev @earendil-works/pi-coding-agent@1.3.0 @earendil-works/pi-tui@1.3.0 typescript
```

- [x] **Step 2: Update package.json**

Set scripts and peer deps:

```json
{
  "scripts": {
    "test": "node --test test/",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

- [x] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["index.ts", "src/**/*.ts", "test/**/*.ts"]
}
```

Imports use explicit `.ts` extensions (jiti resolves them; tsc accepts them
via `allowImportingTsExtensions`).

- [x] **Step 4: Smoke test the runner**

Create `test/smoke.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("runner works", () => {
  assert.equal(1 + 1, 2);
});
```

Run: `node --test test/` -- expected: 1 passing test.
Run: `npx tsc --noEmit` -- expected: clean.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold test runner and typescript config"
```

---

### Task 2: Selection model (`src/selection.ts`)

Pure selection math. No I/O, no pi imports.

**Files:**
- Create: `src/selection.ts`
- Create: `test/selection.test.ts`

- [x] **Step 1: Write failing tests** covering: forward/backward
  normalization; char-wise keeps columns; line-wise expands to full lines
  (col 0 to line length); cursor clamped to last column of line and to file
  bounds; `o` swaps anchor/cursor.

  Shapes:

```ts
export interface Position { line: number; col: number } // 0-based, col in raw chars
export type VisualMode = "char" | "line";
export interface Selection { anchor: Position; cursor: Position; mode: VisualMode }
export interface Range { startLine: number; startCol: number; endLine: number; endCol: number }

export function normalize(sel: Selection, lines: string[]): Range;
export function clampPosition(pos: Position, lines: string[]): Position;
```

  Line-wise semantics: `startCol = 0`, `endCol = lines[endLine].length`
  (end-exclusive), matching how extraction slices.

- [x] **Step 2: Run tests, expect failure.** Run: `node --test test/`

- [x] **Step 3: Implement `src/selection.ts`.** Re-run tests until green.

- [x] **Step 4: Commit** -- `feat(selection): add selection model`

---

### Task 3: File loading and range extraction (`src/file-range.ts`)

**Files:**
- Create: `src/file-range.ts`
- Create: `test/file-range.test.ts`

- [x] **Step 1: Write failing tests** covering: `~` and relative path
  resolution against cwd; reject directories, missing files, NUL-containing
  (binary) files, files over 1 MB; CRLF normalized to LF; extraction of
  full-line ranges, mid-line char ranges, ranges spanning lines; empty file
  returns zero lines; tab and wide-char content extracted byte-faithfully.

  Shapes:

```ts
export type LoadResult =
  | { ok: true; path: string; lines: string[] }   // lines: LF-normalized, no trailing ""
  | { ok: false; reason: "not-found" | "is-directory" | "binary" | "too-large" | "read-error" };

export function resolvePath(input: string, cwd: string): string;
export function loadFile(path: string, maxBytes?: number): LoadResult;
export function extractRange(lines: string[], range: Range): string;
```

  `extractRange` slices raw columns: single-line range slices
  `line.slice(startCol, endCol)`; multi-line keeps middle lines whole.
  Newlines between selected lines are included in the snapshot.

- [x] **Step 2: Run tests, expect failure.**

- [x] **Step 3: Implement.** Use `node:fs` (`statSync` size check before
  read), `node:os` homedir for `~`, `node:path`.

- [x] **Step 4: Commit** -- `feat(file): add file loading with guards and range extraction`

---

### Task 4: Message formatting and token labels (`src/message.ts`)

Pure formatting.

**Files:**
- Create: `src/message.ts`
- Create: `test/message.test.ts`

- [x] **Step 1: Write failing tests** covering: line-wise label `lines 10-20`;
  char-wise label `lines 10:5-12:20` (display is 1-based); single line
  `lines 10`; payload layout with and without comment; language tag in the
  code fence from file extension (plain text when unknown); token label
  `[<display-path>:<label>]` where display-path is relative to cwd when
  possible.

  Shapes:

```ts
export function rangeLabel(range: Range, mode: VisualMode): string;   // "lines 10-20" | "lines 10:5-12:20"
export function displayPath(absPath: string, cwd: string): string;    // relative when inside cwd
export function tokenLabel(absPath: string, cwd: string, range: Range, mode: VisualMode): string; // "[a.ts:10-20]"
export function formatPayload(input: {
  absPath: string; cwd: string; range: Range; mode: VisualMode;
  snapshot: string; comment: string;
}): string;
```

  Payload layout (char-wise example):

```text
In `src/a.ts` (lines 10:5-12:20):
```ts
<snapshot>
```
Comment: <comment>
```

  Omit the `Comment:` line when the comment is empty.

- [x] **Step 2: Run tests, expect failure.**

- [x] **Step 3: Implement.** Language detection: small extension map
  (ts/tsx/js/jsx/py/rs/go/json/md/sh/yaml/toml/css/html), fallback "".

- [x] **Step 4: Commit** -- `feat(message): add payload and token label formatting`

---

### Task 5: Draft store (`src/store.ts`)

**Files:**
- Create: `src/store.ts`
- Create: `test/store.test.ts`

- [x] **Step 1: Write failing tests** covering: add returns a unique token;
  identical file+range annotated twice gets ` ~2` suffix; `list()` order is
  insertion order; `prune(presentTokens)` drops entries whose token is gone;
  `clear()` empties; token lookup by exact match only; `pruneFromText(text)`
  keeps only drafts whose token is a substring of the given text.

  Shapes:

```ts
export interface Draft {
  token: string;            // "[a.ts:10-20]" or "[a.ts:10-20 ~2]"
  absPath: string;
  range: Range;
  mode: VisualMode;
  snapshot: string;
  comment: string;
}

export class AnnotationStore {
  add(draft: Omit<Draft, "token">, baseToken: string): Draft;
  get(token: string): Draft | undefined;
  list(): Draft[];
  prune(presentTokens: string[]): void;
  pruneFromText(text: string): void;   // keeps drafts whose token appears in text
  clear(): void;
}
```

- [x] **Step 2: Run tests, expect failure.**

- [x] **Step 3: Implement** (Map-based, insertion order).

- [x] **Step 4: Commit** -- `feat(store): add annotation draft store`

---

### Task 6: Input transform (`src/transform.ts`)

**Files:**
- Create: `src/transform.ts`
- Create: `test/transform.test.ts`

- [ ] **Step 1: Write failing tests** covering: single token expands inline
  mid-prose; multiple tokens expand in order; user-typed `[a.ts:10-20]` that
  is NOT in the store stays untouched; tokens are regex-escaped (paths with
  `.` or `[`); text without tokens returns unchanged; expansion separates the
  payload from surrounding prose with blank lines.

  Shape:

```ts
export function expandTokens(text: string, store: AnnotationStore): { changed: boolean; text: string };
```

  Expansion of one token:

```text
\n\nIn `path` (lines ...):\n```lang\n<snapshot>\n```\nComment: ...\n\n
```

  Trim trailing whitespace of the preceding prose before inserting.

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement.** Escape tokens via
  `token.replace(/[.*+?^${}()[\]\\|]/g, "\\$&")` before building the RegExp.

- [ ] **Step 4: Commit** -- `feat(transform): add token expansion on input`

---

### Task 7: Composer pill rendering (`src/editor.ts`)

**Files:**
- Create: `src/editor.ts`
- Create: `test/editor.test.ts`

- [x] **Step 1: Write failing tests** for the pure recolor helper:

```ts
export function recolorTokens(line: string, tokens: string[], style: (s: string) => string): string;
```

  Cases: token recolored; unknown text untouched; multiple tokens; ANSI
  width unchanged (`visibleWidth` of output equals input); token not found
  returns input unchanged. Test with a trivial style wrapper
  `(s) => \`<${s}>\``.

- [x] **Step 2: Run tests, expect failure.**

- [x] **Step 3: Implement `recolorTokens`** (plain string split/join on
  exact token occurrences -- the token contains no ANSI, rendered lines are
  the editor's plain text lines).

- [x] **Step 4: Implement `AnnotateEditor`**:

```ts
import { CustomEditor } from "@earendil-works/pi-coding-agent";

export class AnnotateEditor extends CustomEditor {
  constructor(tui, theme, keybindings, private getTokens: () => string[]) {
    super(tui, theme, keybindings);
  }
  override render(width: number): string[] {
    const lines = super.render(width);
    const tokens = this.getTokens();
    if (tokens.length === 0) return lines;
    return lines.map((l) => recolorTokens(l, tokens, (s) => `\x1b[7m${s}\x1b[27m`));
  }
}
```

  Color-only replacement (inverse video). Known limitation, accepted: a
  token split across wrapped lines is not recolored (stays plain text).

- [x] **Step 5: Run tests + typecheck. Commit** -- `feat(editor): add pill recoloring composer editor`

---

### Task 8: Comment input (`src/comment-input.ts`)

Embedded in the card. A small state machine, not pi-tui's full Editor.

**Files:**
- Create: `src/comment-input.ts`
- Create: `test/comment-input.test.ts`

- [x] **Step 1: Write failing tests** for the pure state machine:

```ts
export interface CommentState { text: string }
export type CommentKey =
  | { kind: "char"; ch: string }
  | { kind: "newline" }      // ctrl+j / shift+enter
  | { kind: "backspace" }
  | { kind: "submit" }       // Enter
  | { kind: "cancel" };      // Esc

export function reduceComment(state: CommentState, key: CommentKey):
  { state: CommentState; effect?: { type: "submit"; text: string } | { type: "cancel" } };
```

  Cases: typing appends; newline inserts `\n`; backspace deletes; submit
  emits current text (empty text allowed); cancel emits cancel.

- [x] **Step 2: Run tests, expect failure.**

- [x] **Step 3: Implement** the reducer plus `renderCommentBox(state, width,
  theme): string[]` (bordered box, prompt line `Comment:`, raw text lines).

- [x] **Step 4: Commit** -- `feat(comment): add comment input state machine`

---

### Task 9: Viewer state machine (`src/viewer-state.ts`)

Pure vim reducer -- the card's brain, fully unit-tested.

**Files:**
- Create: `src/viewer-state.ts`
- Create: `test/viewer-state.test.ts`

- [ ] **Step 1: Write failing tests** covering the key table below plus:
  cursor clamping (no wrap past end of line); viewport scrolls to keep the
  cursor visible; `v`/`V` enter/toggle/exit modes; `o` swaps ends; Esc in
  visual mode exits to normal, in normal mode requests close; `q` in normal
  mode requests close; `c` with an active selection enters comment mode;
  comment submit emits the annotation effect and returns to normal mode
  (card stays open).

  Shapes:

```ts
export type ViewerMode = "normal" | "visual-char" | "visual-line" | "comment";

export interface ViewerState {
  mode: ViewerMode;
  cursor: Position;
  anchor: Position | null;
  scrollTop: number;
  comment: CommentState | null;
}

export type ViewerEffect =
  | { type: "annotate"; range: Range; mode: VisualMode; comment: string }
  | { type: "close" };

export function reduceViewer(state: ViewerState, key: string, lines: string[], viewport: { height: number }):
  { state: ViewerState; effect?: ViewerEffect };
```

  Key table (raw input strings): `h j k l`, arrows (`\x1b[A` etc.),
  `0`, `$`, `gg` (two-stroke), `G`, `ctrl+d` (`\x04`) / `ctrl+u` (`\x15`)
  half-page, PgUp/PgDn, `v`, `V`, `o`, `c`, `q`, Esc (`\x1b`). In comment
  mode, keys route to `reduceComment` (Enter = `\r`, ctrl+j = `\n`,
  shift+enter = `\x1b\r`).

- [ ] **Step 2: Run tests, expect failure.**

- [ ] **Step 3: Implement.** Two-stroke keys (`gg`) tracked with a pending-key
  field. Selection during visual modes derives from `anchor` + `cursor` via
  `normalize()`.

- [ ] **Step 4: Commit** -- `feat(viewer): add vim-style viewer state machine`

---

### Task 10: Viewer component (`src/viewer.ts`)

The pi-tui `Component` that renders the card and wires the reducer.

**Files:**
- Create: `src/viewer.ts`
- Create: `test/viewer.test.ts` (render helpers only)

- [ ] **Step 1: Write failing tests** for the pure display helpers:

```ts
export function tabExpanded(s: string, tabSize?: number): string;
export function rawColToDisplayCol(line: string, col: number, tabSize?: number): number;
export function gutterWidth(lineCount: number): number;
```

  Tab mapping: tab advances to the next multiple of `tabSize` (default 4);
  `rawColToDisplayCol` maps a raw column to its display column after
  expansion. Test tabs at various positions and wide chars via
  `visibleWidth`.

- [ ] **Step 2: Run tests, expect failure. Implement helpers.**

- [ ] **Step 3: Implement `AnnotateCard`** (`implements Component`):

```ts
export class AnnotateCard {
  focused = false;
  constructor(
    private tui: TUI,
    private file: { path: string; lines: string[] },   // LF-normalized source
    private pending: Range[],                            // from the store, for markers
    private onAnnotate: (range: Range, mode: VisualMode, comment: string) => void,
    private done: () => void,
  ) {}
  render(width: number): string[] { /* see below */ }
  handleInput(data: string): void { /* feed reduceViewer; on effect: onAnnotate or done() */ }
  invalidate(): void {}
}
```

  Render pipeline per visible line:
  1. Gutter: right-aligned line number; `*` marker column for lines with a
     pending annotation.
  2. Content: `highlightCode(lines.join("\n"), getLanguageFromPath(path))`
     computed once in the constructor; per frame, slice the viewport.
  3. Active selection: for lines intersecting the selection, render the raw
     (tab-expanded, unhighlighted) text with the selected display-column
     span wrapped in inverse video (`\x1b[7m...\x1b[27m`). Selection display
     wins over syntax highlight on those lines.
  4. Pending annotations: underline the covered display span
     (`\x1b[4m...\x1b[24m`) so syntax colors stay visible; underline applies
     AFTER highlighting (wrapping whole-line or spliced span).
  5. Cursor cell in normal/visual mode: inverse video on the cursor column.
  6. Comment mode: append `renderCommentBox` output below the file area.

  All width clipping via `truncateToWidth` / `sliceByColumn` from pi-tui.

- [ ] **Step 4: Typecheck + run all tests. Commit** -- `feat(viewer): add annotate card component`

---

### Task 11: Extension wiring (`index.ts`)

**Files:**
- Create: `index.ts`

- [ ] **Step 1: Implement the extension** (no unit tests; verified by e2e in
  Task 12):

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// ... imports from src/*

export default function (pi: ExtensionAPI) {
  let store: AnnotationStore;
  let editor: AnnotateEditor;

  pi.on("session_start", async (_event, ctx) => {
    store = new AnnotationStore();
    editor = new AnnotateEditor(ctx.ui.tui, ctx.ui.theme, /* keybindings */ undefined, () => store.list().map((d) => d.token));
    ctx.ui.setEditorComponent(editor);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setEditorComponent(undefined);
  });

  pi.registerCommand("annotate", {
    description: "Annotate a range of a file: /annotate <path>",
    handler: async (args, ctx) => {
      const path = resolvePath(args.trim(), ctx.cwd);
      const loaded = loadFile(path);
      if (!loaded.ok) { ctx.ui.notify(`annotate: ${loaded.reason}: ${path}`, "error"); return; }
      await ctx.ui.custom((tui, theme, _kb, done) =>
        new AnnotateCard(tui, { path: loaded.path, lines: loaded.lines },
          store.list().filter((d) => d.absPath === loaded.path).map((d) => d.range),
          (range, mode, comment) => {
            const snapshot = extractRange(loaded.lines, range);
            const draft = store.add({ absPath: loaded.path, range, mode, snapshot, comment },
              tokenLabel(loaded.path, ctx.cwd, range, mode));
            ctx.ui.pasteToEditor(draft.token);
            ctx.ui.notify(`Annotation added: ${draft.token}`);
          },
          done),
        { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } });
    },
  });

  pi.on("input", (event) => {
    const result = expandTokens(event.text, store);
    if (!result.changed) return { action: "continue" };
    store.prune(store.list().map((d) => d.token).filter((t) => event.text.includes(t)));
    return { action: "transform", text: result.text };
  });

  pi.on("message_start", (_event, ctx) =>
    store.pruneFromText(ctx.ui.getEditorText()));
}
```

  Notes for the implementer:
  - Check the real `CustomEditor` constructor signature and
    `ctx.ui.theme`/`ctx.ui.tui` availability in `types.d.ts`; adjust the
    wiring (not the tested modules) as needed.
  - `prune` runs BEFORE expansion is irrelevant; it must run on every input
    event using the pre-expansion text (tokens still visible there).
  - Reconcile on card open: the command handler calls
    `store.prune(...)` against `ctx.ui.getEditorText()` BEFORE constructing
    AnnotateCard, so markers never outlive their pills.
  - AnnotateEditor prunes on text change: override the text-mutation path
    (setText/clear or a handleInput post-check) so deleting a pill prunes
    its draft immediately. Clearing the whole composer therefore clears all
    drafts, which matches the user's mental model.
  - `message_start` must NOT blindly `clear()`: run
    `store.pruneFromText(ctx.ui.getEditorText())` instead. After the user's
    own send the editor is empty, so this clears everything; an unrelated
    RPC/extension message_start keeps drafts whose pills are still present.

- [ ] **Step 2: Typecheck** -- `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** -- `feat: wire annotate extension entry point`

---

### Task 12: README and manual e2e

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md** (English): what it does, install
  (`npm install` / pi package install), usage (`/annotate <path>`, key
  table), payload example, development (`npm test`, `npm run typecheck`).

- [ ] **Step 2: Manual e2e checklist** -- run `pi --extension ./index.ts` and
  verify each item, checking the box after each:
  - [ ] `/annotate <file>` opens the card; syntax highlight visible; line numbers correct
  - [ ] `hjkl`/arrows/`gg`/`G`/`0`/`$`/ctrl+d/ctrl+u move as expected; no cursor past line end
  - [ ] `v` char-wise selection renders inverse; `V` line-wise; `o` swaps; Esc cancels
  - [ ] `c` opens comment box; Enter submits; ctrl+j and shift+enter insert newlines; Esc cancels
  - [ ] After submit: pill `[path:lines]` appears in composer (inverse-rendered); card stays open
  - [ ] Second annotation on the same file works; reopened card shows `*` markers + underlines
  - [ ] Deleting a pill removes its annotation (send a message and confirm expansion skips it)
  - [ ] Sending expands pills into quote blocks with exact snapshot text
  - [ ] Errors: missing file, directory, binary file all notify cleanly

- [ ] **Step 3: Update STATUS.md** (plan done) and commit -- `docs: add readme`

---

## Self-review

Coverage: every spec module maps to a task (status.ts removed per spec).
TDD: every logic module has failing tests before implementation; TUI wiring
is covered by pure-helper tests + manual e2e. Placeholder scan: the only
intentional gap is the CustomEditor constructor details in Task 11, flagged
in-line. Type consistency: `Range`, `VisualMode`, `Draft` are defined once
in `selection.ts`/`store.ts` and reused.
