---
title: Viewer Search - Implementation Plan
status: in-progress
progress: 1/5
spec: ../specs/2026-10-18-viewer-search-design.md
---

# Viewer Search - Implementation Plan

> **For AI agent workers:** required sub-skill: use subagent-driven-development (recommended) or executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax to track progress.

**Goal:** Add vim-style `/` search (regex + smartcase, incremental, hlsearch highlight, `{count}` prefix) to the annotate card, plus a ride-along chrome inner-padding fix.

**Architecture:** A new pure `src/search.ts` module (compile/scan/jump) with no I/O; search mode, count prefix, and transient messages in the `viewer-state.ts` reducer; presentation in `status-line.ts` (search segment, cmdline input row, message widget); per-render match highlighting wired in `viewer.ts`. The padding fix lands first in `card-chrome.ts` (`PAD_X`) with coordinated budget shifts in `viewer.ts`.

**Tech stack:** TypeScript (jiti, no build), node:test, pi-tui display helpers (`visibleWidth`, `truncateToWidth`, `sliceByColumn`).

**Spec:** `docs/superpowers/specs/2026-10-18-viewer-search-design.md` — the plan's authority; executors read both.

## Global constraints

- All code, comments, test names, and commit messages in English; no non-ASCII characters except UI strings (border glyphs, badges).
- New `ViewerState` fields are optional with undefined-as-default semantics (the `scrollLeft`/`editingDraftId` precedent): the reducer treats `undefined` like `null`; the spec's interface sketch shows them required, this plan's convention overrides it so existing test fixtures keep compiling.
- vim message wording verbatim: `search hit BOTTOM, continuing at TOP`, `search hit TOP, continuing at BOTTOM`, `Pattern not found: <pattern>`.
- The padding width is one named constant `PAD_X = 1` exported from `src/card-chrome.ts`; no padding literals elsewhere.
- Test commands: focused `node --test test/<file>.test.ts`; before every commit `npm test` + `npx tsc --noEmit`, both green.
- Semantic commit messages; never touch `package.json` `"version"` or `CHANGELOG.md`.
- Steps marked "manual E2E (human confirms)" are user-gated: subagent implementers stop before them and report; the controller collects the user's confirmation.

## Review focus

1. Zero-width patterns (`a*`, `^`): the scan must terminate and the jump must not loop; highlight renders nothing for them. Pinned by Task 2 tests (zero-width advancement, jumpTarget over zero-width matches).
2. Tabbed and CJK lines: matching is in raw code-unit columns, rendering in display columns; the mapping must go through `rawColToDisplayCol` only. Pinned by Task 2 (raw columns) and Task 5 (display spans) tests.
3. A message must survive exactly one render and re-appear on repeated identical events (two wraps in a row both show the notice). Pinned by the Task 3 clear-then-dispatch rule and its message tests.
4. Invalid pattern submitted with Enter: search mode stays open with the error visible; nothing throws. Pinned by Task 3 tests.
5. Narrow terminals: the search segment drops before the selection range, badge/position never drop, the cmdline input keeps its cursor cell visible. Pinned by Task 4 tests and the Task 1 border invariant (probed at widths where the content fits the budget; framePanel keeps its no-rewrite contract for overlong rows).

## File structure

- Create `src/search.ts` — pure search primitives (no pi imports beyond types).
- Modify `src/viewer-state.ts` — `"search"` mode, count prefix, transient message.
- Modify `src/status-line.ts` — search badge/segment, cmdline `input` final rendering, message widget.
- Modify `src/card-chrome.ts` — `PAD_X` inner padding.
- Modify `src/viewer.ts` — content-width budgets, match highlight span, statusline/cmdline wiring.
- Tests: new `test/search.test.ts`; extend `test/viewer-state.test.ts`, `test/status-line.test.ts`, `test/card-chrome.test.ts`, `test/viewer.test.ts`.

---

### Task 1: Chrome inner padding (`PAD_X`)

**Files:**
- Modify: `src/card-chrome.ts` (`innerRow`, `frameCommentBox`, new export `PAD_X`)
- Modify: `src/viewer.ts` (`render`, `overlayCommentBox`, `overlayPreview`, `paintCommentBox`, the method deriving the reducer's `contentWidth` from `renderedInner`)
- Test: `test/card-chrome.test.ts`, `test/viewer.test.ts`

- [x] **Step 1: Write the failing tests**

Add to `test/card-chrome.test.ts` (verbatim):

```ts
test("inner rows keep one blank padding column inside each border at any width", () => {
  // Widths where the 8-column content fits the budget (width - 2 - 2 * PAD_X
  // >= 8); framePanel never rewrites overlong content, so degenerate widths
  // are out of scope for this invariant.
  for (const width of [12, 13, 16, 20, 40]) {
    const rows = framePanel(["abcdefgh"], width, { colors: plain });
    const inner = rows[1];
    assert.equal(visibleWidth(inner), width);
    assert.equal(inner[1], " ");
    assert.equal(inner[width - 2], " ");
  }
});
```

Update the canonical `framePanel` expectation (verbatim new value):

```ts
const rows = framePanel(["ab", "cd"], 10, { title: "T", footers: ["F"], colors });
assert.deepEqual(rows, [
  "bg(b(╭─ T ────╮))",
  "bg(b(│) ab     b(│))",
  "bg(b(│) cd     b(│))",
  "bg(b(│) F      b(│))",
  "bg(b(╰────────╯))",
]);
```

Update `frameCommentBox` expectations to the new rule: inner lines are truncated to `width - 2 - 2 * PAD_X` (i.e. `width - 4`) and padded rows keep one blank column inside each border; e.g. `frameCommentBox(["hello world"], 10, plain, "C")` yields the inner row `"│ hello… │"` (6-column content, pi-tui default ellipsis).

Update the exact-row assertions in `test/viewer.test.ts` under the uniform rewrite rule: every framed row gains one blank column inside each border, and every content budget (row content, statusline, cmdline, comment box) shrinks by 2 display columns. Layout invariants (row widths, gutter, alignment) are unchanged.

- [x] **Step 2: Run the tests, verify failure**

Run: `node --test test/card-chrome.test.ts`
Expected: FAIL (new invariant test: `inner[1]` is not `" "`).

- [x] **Step 3: Implement `PAD_X`**

In `src/card-chrome.ts`:

```ts
// Blank columns reserved inside the left and right borders of every framed
// row, so content never touches the border glyphs.
export const PAD_X = 1;
```

`innerRow` becomes border + `PAD_X` spaces + content + pad + `PAD_X` spaces + border, with `pad = " ".repeat(Math.max(0, width - 2 - 2 * PAD_X - visibleWidth(content)))`. `frameCommentBox` truncates inner lines to `width - 2 - 2 * PAD_X`. No other chrome function changes: `commentBoxPlacement` and `spliceRow` work in content-string coordinates and are padding-agnostic.

In `src/viewer.ts` (import `PAD_X` from `./card-chrome.ts`):

- `render()`: `const contentW = inner - 2 * PAD_X`; use `contentW` (was `inner`) for the row window budget `cw = Math.max(1, contentW - gutterW)`, the row padding target, the `renderStatusLine`/`renderCommandLine` width argument, and store nothing extra (the reducer budget comes from the method below).
- The method deriving the reducer viewport's `contentWidth` from `renderedInner` subtracts `2 * PAD_X` before subtracting the gutter.
- `overlayCommentBox`: `boxW = Math.min(contentW, EDITOR_BOX_MAX_WIDTH)`; wrap width `Math.max(1, boxW - 2 - 2 * PAD_X)`. `overlayPreview`: `boxW = Math.min(contentW, Math.max(widest + 3 + 2 * PAD_X, title.length + 6))`.
- `paintCommentBox`: pass `contentW` as `commentBoxPlacement`'s `innerW`; `selCol` and the `spliceRow` offset are unchanged (content coordinates).
- Both overlay methods receive `contentW` from `render` (adjust their signatures or compute inside; one consistent choice).

- [x] **Step 4: Run the tests, verify pass**

Run: `node --test test/card-chrome.test.ts test/viewer.test.ts`
Expected: PASS (all updated assertions green).

- [x] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [x] **Step 6: Manual E2E (human confirms)** (confirmed 2026-10-19; narrow-terminal item untestable in the current environment, deferred)

Sandbox: `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`
Check: gutter/text no longer touch the panel borders; the comment box and preview box show the same inner padding; nothing misaligns on hscroll, on a narrow terminal, and with CJK content.

- [x] **Step 7: Commit**

```bash
git add src/card-chrome.ts src/viewer.ts test/card-chrome.test.ts test/viewer.test.ts
git commit -m "feat(viewer): pad framed rows inside the vertical borders"
```

---

### Task 2: `src/search.ts` pure module

**Files:**
- Create: `src/search.ts`
- Test: `test/search.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `test/search.test.ts` (verbatim core cases; node:test style like the other suites):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { compilePattern, findMatches, jumpTarget } from "../src/search.ts";
import type { LineMatch } from "../src/search.ts";

const M: LineMatch[] = [
  { line: 1, startCol: 0, endCol: 3 },
  { line: 3, startCol: 2, endCol: 5 },
  { line: 5, startCol: 1, endCol: 2 },
];

test("compilePattern: smartcase flags", () => {
  const lower = compilePattern("foo");
  assert.ok(lower.ok);
  assert.equal(lower.re.flags, "gi");
  const upper = compilePattern("Foo");
  assert.ok(upper.ok);
  assert.equal(upper.re.flags, "g");
});

test("compilePattern: invalid pattern returns the engine message, never throws", () => {
  const bad = compilePattern("(");
  assert.ok(!bad.ok);
  assert.ok(typeof bad.error === "string" && bad.error.length > 0);
});

test("findMatches: multiple matches per line, raw columns", () => {
  assert.deepEqual(findMatches(["foo bar foo"], /foo/g), [
    { line: 0, startCol: 0, endCol: 3 },
    { line: 0, startCol: 8, endCol: 11 },
  ]);
});

test("findMatches: lastIndex resets per line", () => {
  assert.deepEqual(findMatches(["foo", "foo"], /foo/g), [
    { line: 0, startCol: 0, endCol: 3 },
    { line: 1, startCol: 0, endCol: 3 },
  ]);
});

test("findMatches: zero-width matches advance and terminate", () => {
  assert.deepEqual(findMatches(["bbb"], /a*/g), [
    { line: 0, startCol: 0, endCol: 0 },
    { line: 0, startCol: 1, endCol: 1 },
    { line: 0, startCol: 2, endCol: 2 },
    { line: 0, startCol: 3, endCol: 3 },
  ]);
});

test("findMatches: raw columns on tabbed and CJK lines", () => {
  assert.deepEqual(findMatches(["\tfoo"], /foo/g), [{ line: 0, startCol: 1, endCol: 4 }]);
  assert.deepEqual(findMatches(["中中x"], /x/g), [{ line: 0, startCol: 2, endCol: 3 }]);
});

test("jumpTarget: forward with counts and wrap flag", () => {
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 2), { pos: { line: 5, col: 1 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 3), { pos: { line: 1, col: 0 }, wrapped: true });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, 1, 4), { pos: { line: 3, col: 2 }, wrapped: true });
});

test("jumpTarget: strictly after the from position", () => {
  assert.deepEqual(jumpTarget(M, { line: 1, col: 1 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 2, col: 0 }, 1, 1), { pos: { line: 3, col: 2 }, wrapped: false });
});

test("jumpTarget: backward with wrap flag", () => {
  assert.deepEqual(jumpTarget(M, { line: 3, col: 2 }, -1, 1), { pos: { line: 1, col: 0 }, wrapped: false });
  assert.deepEqual(jumpTarget(M, { line: 1, col: 0 }, -1, 1), { pos: { line: 5, col: 1 }, wrapped: true });
});

test("jumpTarget: empty matches return null; zero-width matches are jumpable", () => {
  assert.equal(jumpTarget([], { line: 0, col: 0 }, 1, 1), null);
  const zw: LineMatch[] = [{ line: 0, startCol: 1, endCol: 1 }];
  assert.deepEqual(jumpTarget(zw, { line: 0, col: 0 }, 1, 1), { pos: { line: 0, col: 1 }, wrapped: false });
});
```

- [ ] **Step 2: Run the tests, verify failure**

Run: `node --test test/search.test.ts`
Expected: FAIL, module not found (`../src/search.ts`).

- [ ] **Step 3: Implement `src/search.ts`**

Pure module, no pi imports beyond the `Position` type from `./selection.ts`:

```ts
export interface LineMatch { line: number; startCol: number; endCol: number } // raw columns, endCol exclusive
export type CompiledPattern = { ok: true; re: RegExp } | { ok: false; error: string };

export function compilePattern(pattern: string): CompiledPattern;
export function findMatches(lines: string[], re: RegExp): LineMatch[];
export function jumpTarget(
  matches: LineMatch[],
  from: Position,
  dir: 1 | -1,
  count: number,
): { pos: Position; wrapped: boolean } | null;
```

- `compilePattern`: flags `"g"` plus `"i"` when the pattern contains no uppercase ASCII letter; wraps `new RegExp` in try/catch and returns `{ ok: false, error }` with the engine message.
- `findMatches`: scans each line independently; resets `re.lastIndex = 0` per line; after a zero-width match advances `lastIndex` by one code unit so the scan terminates.
- `jumpTarget`: a match is after `from` when `line > from.line || (line === from.line && startCol > from.col)` (before mirrors); takes the `count`-th match in `dir` order, wrapping around the file and reporting `wrapped`; `null` when `matches` is empty. The returned `pos` is `{ line: match.line, col: match.startCol }`.

- [ ] **Step 4: Run the tests, verify pass**

Run: `node --test test/search.test.ts`
Expected: PASS, all 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/search.ts test/search.test.ts
git commit -m "feat(viewer): add pure search primitives module"
```

---

### Task 3: Search mode, count prefix, and messages in `viewer-state.ts`

**Files:**
- Modify: `src/viewer-state.ts`
- Test: `test/viewer-state.test.ts`

Uses Task 2's `compilePattern`/`findMatches`/`jumpTarget` (import from `./search.ts`).

- [ ] **Step 1: Write the failing tests**

Extend `test/viewer-state.test.ts` using its existing `LINES` (30 lines `"line 0"`..`"line 29"`), `VP`, `viewer()`, `view()` fixtures. Matches of `"2"`: `line 2` col 5, `line 12` col 6, `line 20`..`line 29` col 5. Verbatim core cases:

```ts
test("search: / enters search mode with the cursor as origin and resets count", () => {
  const res = view(viewer({ cursor: { line: 2, col: 3 }, count: 5 }), "/");
  assert.equal(res.state.mode, "search");
  assert.deepEqual(res.state.search, { query: "", origin: { line: 2, col: 3 } });
  assert.equal(res.state.count ?? null, null);
});

test("search: incremental jump per keystroke, forward from origin, no wrap", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "2").state; // "line 2" has "2" at col 5, on the origin line past col 3
  assert.deepEqual(st.cursor, { line: 2, col: 5 });
  assert.deepEqual(st.search?.query, "2");
  st = view(st, "0").state; // "20" first occurs on line 20
  assert.deepEqual(st.cursor, { line: 20, col: 5 });
  st = view(st, "\x7f").state; // back to query "2"
  assert.deepEqual(st.cursor, { line: 2, col: 5 });
});

test("search: no match keeps the cursor at origin", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "z").state;
  assert.deepEqual(st.cursor, { line: 2, col: 3 });
});

test("search: invalid pattern sets the message and keeps the cursor at origin", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "(").state;
  assert.equal(st.mode, "search");
  assert.ok(typeof st.message === "string" && st.message.length > 0);
  assert.deepEqual(st.cursor, { line: 2, col: 3 });
});

test("search: Enter submits, stores lastSearch, keeps the jumped cursor", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 } }), "/").state;
  st = view(st, "2").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.lastSearch, "2");
  assert.deepEqual(res.state.cursor, { line: 2, col: 5 });
  assert.equal(res.state.search, null);
});

test("search: Enter on an invalid pattern stays in search mode", () => {
  let st = view(viewer(), "/").state;
  st = view(st, "(").state;
  const res = view(st, "\r");
  assert.equal(res.state.mode, "search");
  assert.ok(typeof res.state.message === "string" && res.state.message.length > 0);
});

test("search: Esc restores the origin cursor and keeps lastSearch", () => {
  let st = view(viewer({ cursor: { line: 2, col: 3 }, lastSearch: "9" }), "/").state;
  st = view(st, "2").state; // incremental jump to {2,5}
  const res = view(st, "\x1b");
  assert.equal(res.state.mode, "normal");
  assert.deepEqual(res.state.cursor, { line: 2, col: 3 });
  assert.equal(res.state.lastSearch, "9");
});

test("search: empty Enter repeats lastSearch forward like n; without lastSearch it just exits", () => {
  const withLast = view(
    viewer({ mode: "search", cursor: { line: 2, col: 5 }, search: { query: "", origin: { line: 2, col: 5 } }, lastSearch: "2" }),
    "\r",
  );
  assert.equal(withLast.state.mode, "normal");
  assert.deepEqual(withLast.state.cursor, { line: 12, col: 6 });
  const noLast = view(
    viewer({ mode: "search", cursor: { line: 7, col: 1 }, search: { query: "", origin: { line: 7, col: 1 } } }),
    "\r",
  );
  assert.equal(noLast.state.mode, "normal");
  assert.deepEqual(noLast.state.cursor, { line: 7, col: 1 });
});

test("n/N: jump with wrap messages, Pattern not found, inert without lastSearch", () => {
  const fwd = view(viewer({ cursor: { line: 29, col: 5 }, lastSearch: "2" }), "n");
  assert.deepEqual(fwd.state.cursor, { line: 2, col: 5 });
  assert.equal(fwd.state.message, "search hit BOTTOM, continuing at TOP");
  const bwd = view(viewer({ cursor: { line: 2, col: 5 }, lastSearch: "2" }), "N");
  assert.deepEqual(bwd.state.cursor, { line: 29, col: 5 });
  assert.equal(bwd.state.message, "search hit TOP, continuing at BOTTOM");
  const none = view(viewer({ cursor: { line: 0, col: 0 }, lastSearch: "zzz" }), "n");
  assert.equal(none.state.message, "Pattern not found: zzz");
  assert.deepEqual(none.state.cursor, { line: 0, col: 0 });
  const inert = view(viewer({ cursor: { line: 0, col: 0 } }), "n");
  assert.deepEqual(inert.state.cursor, { line: 0, col: 0 });
  assert.equal(inert.state.message ?? null, null);
});

test("message: cleared by the next keypress, re-shown on a repeated identical event", () => {
  const wrapped = view(viewer({ cursor: { line: 29, col: 5 }, lastSearch: "2" }), "n");
  assert.equal(wrapped.state.message, "search hit BOTTOM, continuing at TOP");
  const cleared = view(wrapped.state, "j");
  assert.equal(cleared.state.message ?? null, null);
  const rewrapped = view(wrapped.state, "N"); // wrap the other way from the same spot
  assert.equal(rewrapped.state.message, "search hit TOP, continuing at BOTTOM");
});

test("count: {count}j / {count}G consume the count, digits accumulate", () => {
  assert.deepEqual(view(viewer(), "2").state.count, 2);
  assert.deepEqual(view(view(viewer(), "2").state, "3").state.count, 23);
  assert.deepEqual(view(view(viewer(), "2").state, "j").state.cursor.line, 2);
  assert.deepEqual(view(view(viewer(), "3").state, "G").state.cursor.line, 2);
  assert.deepEqual(view(view(viewer(), "9").state, "9").state.count, 99);
  assert.deepEqual(view(view(view(viewer(), "9").state, "9").state, "G").state.cursor.line, 29); // clamped: 99G -> last line
});

test("count: bare 0 stays the column-0 motion; 0 extends a pending count", () => {
  assert.deepEqual(view(viewer({ cursor: { line: 0, col: 4 } }), "0").state.cursor.col, 0);
  const twenty = view(view(viewer(), "2").state, "0").state;
  assert.equal(twenty.count, 20);
});

test("count: any other key clears it without effect; {count}n repeats the search", () => {
  const visual = view(view(viewer(), "2").state, "v");
  assert.equal(visual.state.mode, "visual-char");
  assert.equal(visual.state.count ?? null, null);
  const jump = view(view(viewer({ cursor: { line: 2, col: 5 }, lastSearch: "2" }), "2").state, "n");
  assert.deepEqual(jump.state.cursor, { line: 20, col: 5 });
  assert.equal(jump.state.count ?? null, null);
});
```

- [ ] **Step 2: Run the tests, verify failure**

Run: `node --test test/viewer-state.test.ts`
Expected: FAIL (no `"search"` mode; `count`/`message`/`lastSearch` unknown).

- [ ] **Step 3: Implement**

In `src/viewer-state.ts`:

- `ViewerMode` gains `"search"`. `ViewerState` gains optional fields: `search?: { query: string; origin: Position } | null`, `lastSearch?: string | null`, `count?: number | null`, `message?: string | null` (undefined treated as null).
- Message lifecycle in `reduceViewer`: clear `message` on the incoming state before dispatch (every branch that wants one sets it fresh), so a message survives exactly one render and repeated identical events re-show it.
- Search entry: `case "/"` in `handleMode`, normal mode only: `mode: "search"`, `search: { query: "", origin: state.cursor }`, `count: null`.
- `searchStep(state, key, lines, viewport)`: route every search-mode key. Classification reuses `toCommentKey`: `char` appends the chunk to `query`, `backspace` pops one code unit, `submit` is Enter, `cancel` is Esc, `newline` is ignored (single-line input).
  After every query change: `compilePattern(query)`; invalid -> `message` = error, cursor stays at `origin`; valid -> `findMatches(lines, re)`, jump the cursor to the first match with `line > origin.line || (line === origin.line && startCol >= origin.col)` (none -> cursor stays at `origin`), via the existing `keepVisible` path.
  Enter: invalid pattern -> stay in search mode (the compile error is re-set as `message`, since the wrapper cleared the incoming one); empty query with a `lastSearch` -> behave like `{count}n` with count 1 from the cursor (wrap message included), exit to normal; empty query without `lastSearch` -> exit to normal, cursor at origin; otherwise `lastSearch = query`, exit to normal, cursor stays where the incremental jump left it, `search: null`.
  Esc: exit to normal, `search: null`, cursor restored to `origin` through `keepVisible`, `lastSearch` untouched.
- Count prefix in `reduceViewer` (normal mode only, before two-stroke handling): with no pending count, `1`-`9` start `count`; with a pending count, `0`-`9` extend it (`count * 10 + d`); a bare `0` falls through to the existing column-0 case.
- Consumers read `count ?? 1` and clear it: `j`/`k` (lines), `h`/`l` (columns), `G` (`{count}G` goes to 1-based line `count`, clamped), `n`/`N`. Any other key clears `count` without effect: wrapper rule - after `handleMode`, if the key was not a digit and the branch returned `count` unchanged, set it to `null`.
- `n`/`N` in `handleMode`, normal mode only: `lastSearch` null -> inert; compile (defensive: `!ok` -> `message` = error, cursor stays); `findMatches` empty -> `message: "Pattern not found: " + lastSearch`, cursor stays; else `jumpTarget(matches, cursor, dir, count ?? 1)` -> move via `moved`, `count: null`, and when `wrapped` set the vim message for the direction.

- [ ] **Step 4: Run the tests, verify pass**

Run: `node --test test/viewer-state.test.ts`
Expected: PASS (old + new).

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/viewer-state.ts test/viewer-state.test.ts
git commit -m "feat(viewer): add search mode, count prefix, and transient messages"
```

---

### Task 4: Search presentation in `status-line.ts`

**Files:**
- Modify: `src/status-line.ts`
- Test: `test/status-line.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend `test/status-line.test.ts` (verbatim core cases; `plain` marker colors per the file's convention):

```ts
test("statusline: normal mode shows /pattern [rank/total] between badge and position", () => {
  const row = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    40,
    plain,
  );
  assert.equal(row, "-- NORMAL --  /foo [2/7]            12:5");
});

test("statusline: search mode shows only [rank/total]", () => {
  const row = renderStatusLine(
    { mode: "search", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    40,
    plain,
  );
  assert.equal(row, "-- SEARCH --  [2/7]                 12:5");
});

test("statusline: search segment drops as a whole under narrow widths", () => {
  const row = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "foo", rank: 2, total: 7 } },
    20,
    plain,
  );
  assert.equal(row, "-- NORMAL --    12:5");
  const longPattern = renderStatusLine(
    { mode: "normal", cursor: { line: 12, col: 5 }, search: { pattern: "x".repeat(30), rank: 1, total: 1 } },
    40,
    plain,
  );
  assert.equal(longPattern, "-- NORMAL --                        12:5");
});

test("statusline: visual and comment modes hide the search segment", () => {
  const row = renderStatusLine(
    {
      mode: "visualChar",
      cursor: { line: 12, col: 5 },
      selection: { start: { line: 3, col: 1 }, end: { line: 4, col: 2 }, kind: "char" },
      search: { pattern: "foo", rank: 2, total: 7 },
    },
    60,
    plain,
  );
  assert.ok(!row.includes("/foo"));
  assert.ok(row.includes("3:1-4:2"));
});

test("cmdline input: prompt, value, and inverse cursor cell; padded to width", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "foo", cursorCol: 3 }, 10, plain);
  assert.equal(row, "/foo\x1b[7m \x1b[27m     ");
});

test("cmdline input: overflow windows tail-biased, prompt and cursor stay visible", () => {
  const row = renderCommandLine({ kind: "input", prompt: "/", value: "abcdefghijklmn", cursorCol: 14 }, 10, plain);
  assert.equal(row, "/ghijklmn\x1b[7m \x1b[27m");
});

test("cmdline hints: message right-aligned in accent, hints truncate first", () => {
  const row = renderCommandLine(
    { kind: "hints", mode: "normal", message: "Pattern not found: foo" },
    40,
    colors,
  );
  assert.equal(row, "d(hjkl move  v/V se) a(Pattern not found: foo)");
});
```

(The last case assumes the new normal hints text below and the file's marker `colors`: hints truncated to `40 - 22 - 1 = 17` columns, a one-space gap, message intact.)

- [ ] **Step 2: Run the tests, verify failure**

Run: `node --test test/status-line.test.ts`
Expected: FAIL (no `search` mode, no segment, no message widget, interim input rendering).

- [ ] **Step 3: Implement**

In `src/status-line.ts`:

- `CardMode` gains `"search"`; `cardModeOf` maps it; `FOOTER_HINTS.search = { badge: "-- SEARCH --", hints: "" }` (badge/typing completeness only).
- `FOOTER_HINTS.normal.hints` becomes exactly:
  `hjkl move  v/V select  / search  n/N next/prev  c/x comment/delete  p preview  q/Esc close`
- `StatusLineInput` gains `search?: { pattern: string; rank: number; total: number } | null`.
- `renderStatusLine`: segment = `/` + pattern + ` [rank/total]` in normal mode, `[rank/total]` in search mode, `null` in visual/comment modes. Layout mirrors the selection range: badge + two spaces + segment + pad + position when `badgeW + 2 + segW + 1 + posW <= innerWidth`; otherwise the segment drops as a whole (never truncated) before the selection range; badge and position are always preserved.
- `CommandLineInput` hints variant gains `message?: string | null`: rendered right-aligned in `colors.accent`; the hints truncate first to `innerWidth - msgW - 1` with a one-space gap; the message is preserved whole unless it alone exceeds `innerWidth` (then `truncateToWidth`).
- `input` variant final rendering: `colors.accent(prompt)` + value in default text + one inverse cursor cell. The inverse cell is raw SGR like `viewer.ts` (`\x1b[7m \x1b[27m`); add local constants mirroring viewer's. On overflow the value windows tail-biased: the prompt never scrolls, the cursor cell is always the last column (`prompt + last (innerWidth - promptW - 1) columns of value + cursor cell`). `cursorCol` stays in the type, reserved for future mid-line editing; rendering is append-only. Amended during Task 5 review (2026-10-19): the input variant also takes an optional `message` rendered as the same right-aligned widget as the hints variant - without it the invalid-pattern compile error was invisible in search mode (fix commit `e0ee5fe`).

- [ ] **Step 4: Run the tests, verify pass**

Run: `node --test test/status-line.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/status-line.ts test/status-line.test.ts
git commit -m "feat(viewer): render search segment, cmdline input, and messages"
```

---

### Task 5: Match highlighting and wiring in `viewer.ts`

**Files:**
- Modify: `src/viewer.ts`
- Test: `test/viewer.test.ts`

Uses Task 2's primitives, Task 3's state fields, Task 4's renderers.

- [ ] **Step 1: Write the failing tests**

Extend `test/viewer.test.ts` using its existing card harness (scenario + expected specifics; assertion style per the file's existing span tests):

```ts
test("highlight: matches of lastSearch are styled on tabbed and CJK lines", () => {
  // File lines: "\tfoo bar", "中foo". lastSearch "foo", cursor parked off-match.
  // Expect the "foo" cells wrapped in the match style at display columns
  // [4,7) on line 0 (tab expands to 4) and [2,5) on line 1.
});

test("highlight: match composes with pending underline, loses to inverse selection", () => {
  // A pending draft underlining a match: both underline SGR and the match
  // style present on the segment. A visual selection over the match: the
  // segment renders inverse (selection wins).
});

test("highlight: persists in comment mode (hlsearch)", () => {
  // lastSearch set, card in comment mode: the match style is still present
  // in the content rows.
});

test("wiring: search mode renders the cmdline input and the [rank/total] segment", () => {
  // After "/", typing "foo": the last footer row shows "/foo" + inverse
  // cursor cell; the statusline row shows "-- SEARCH --" and "[1/2]" for a
  // two-match file with the cursor on the first match.
});

test("wiring: a transient message renders right-aligned and clears on the next key", () => {
  // After a wrapping n: the cmdline shows "search hit BOTTOM, continuing at
  // TOP"; after the next keypress it is gone.
});
```

- [ ] **Step 2: Run the tests, verify failure**

Run: `node --test test/viewer.test.ts`
Expected: FAIL (no match style, no search wiring).

- [ ] **Step 3: Implement**

In `src/viewer.ts`:

- `SpanStyle` gains `"match"`; ~~`spanStyles.match = (s) => this.colors.accent(BOLD_ON + s + INTENSITY_OFF)` (accent fg + bold: composes with the underline attributes; distinct from every existing style).~~ Amended after user E2E (2026-10-19): too subtle in practice - `spanStyles.match = (s) => theme.bg("searchMatchBg", theme.fg("searchMatchText", s))`, mirroring pi's transcript search; still composes with underlines, still loses to inverse.
- `applyStyleSpans`: `match` stays out of the strongest-emphasis race and composes like `inverse`: the final filter becomes `s === "inverse" || s === "match" || s === strongest`. Precedence unchanged otherwise: `inverse` still wins visually.
- Per `render()`: the active pattern is `state.search.query` in search mode (skip when empty), else `state.lastSearch` (skip when null). `compilePattern` once per render; on `!ok` render no highlight (the error already shows as the cmdline message). `findMatches(this.file.lines, re)` once per render; per line map each match to a display-column `StyleSpan` via `rawColToDisplayCol(line, startCol)` / `rawColToDisplayCol(line, endCol)` (zero-width spans are dropped by `applyStyleSpans`'s `end > start` filter - intended). Pass the per-line spans into `renderLine`, which merges them with the existing selection/cursor/emphasis spans.
- Statusline input: normal mode with a `lastSearch`, and search mode, pass `search: { pattern, rank, total }`; visual/comment modes pass `null`. `rank` is the 1-based index of the match containing the cursor (`match.line === cursor.line && startCol <= col && col < endCol`; zero-width matches never count), `0` when the cursor is on no match; `total = matches.length`.
- Cmdline input: search mode -> `{ kind: "input", prompt: "/", value: state.search.query, cursorCol: state.search.query.length }`; every other mode -> `{ kind: "hints", mode, message: state.message ?? null }`.
- Constructor initial state gains `search: null, lastSearch: null, count: null, message: null`.

- [ ] **Step 4: Run the tests, verify pass**

Run: `node --test test/viewer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/viewer.ts test/viewer.test.ts
git commit -m "feat(viewer): highlight search matches and wire the search UI"
```

- [ ] **Step 7: Manual E2E (human confirms)**

Sandbox: `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`
Check: `/` + incremental jump per keystroke; invalid pattern shows the error and Enter stays in search; Esc restores the origin; `n`/`N` with wrap notices; `{count}n`, `{count}j`, `{count}G`, bare `0`; highlight in visual and comment modes; `[rank/total]` segment; narrow-terminal truncation; CJK/tabbed fixture file.
