---
title: Src Module Layout - Implementation Plan
status: in-progress
progress: 0/2
spec: ../specs/2026-10-20-src-module-layout-design.md
---

# Src Module Layout - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers-zh:subagent-driven-development (controller side) or superpowers-zh:executing-plans (worker side).
> Steps use checkbox syntax `- [ ]` for tracking.

**Goal:** reorganize `src/` into explicit layers (`core/`, `tui/`, `viewer/`) and split the viewer monolith, with zero behavior change.
**Architecture:** one-way dependency direction `core <- tui <- viewer <- index.ts`, enforced by a new `test/architecture.test.ts`; module map documented in `src/AGENTS.md`.
**Tech stack:** TypeScript, `module: nodenext` (import specifiers keep the `.ts` extension), node:test.
**Spec:** `docs/superpowers/specs/2026-10-20-src-module-layout-design.md` (approved).
**Execution:** worktree `.pi/worktrees/src-module-layout/` (branch `refactor/src-module-layout`); worker model `zai-coding-cn/glm-5.3-flash`, reviewer model `zai-coding-cn/glm-5.3`, controller is the main session (user direction, 2026-10-20).

## Global constraints

- Zero behavior change: every step is file move or code motion only; no logic edits, no renames of exported symbols.
- `npm test` and `npx tsc --noEmit` must be green before every commit.
- Test-count invariant: baseline is **366 pass / 0 fail** (`node --test "test/**/*.test.ts"`, recorded 2026-10-20); every step ends at the same total unless a step explicitly moves tests, in which case the total is still 366.
- Flake note: on 2026-10-20 one run exited 1 despite a `fail 0` summary, unreproducible in 6 reruns; if that happens, re-run once and only investigate a reproducible failure.
- Semantic commits of type `refactor(src)` / `test(src)` / `docs(src)`; never touch `package.json` version or `CHANGELOG.md`.
- ASCII only in all files (UI strings with Nerd Font icons excepted); Markdown is one sentence per line.
- Plan checkboxes, front-matter `progress`, and `STATUS.md` update in the same commit as the task that completes them (docs.test.ts enforces this).

## Review Focus

The five most likely hazards:

1. Import-depth errors in nested test dirs (`../src/` becomes `../../src/<layer>/`) -- covered by Task 1 step 2 rewrite rules and the suite run; node --test fails loudly on unresolvable imports.
2. Runtime circular imports between `viewer/state.ts` and the mode modules -- prevented by the `import type` rule in Task 2 step 3; a violation shows up as `undefined` at runtime and fails the suite.
3. Test glob `"test/**/*.test.ts"` silently skipping nested dirs -- verification step compares the total count (366) before and after Task 1.
4. Accidental logic edits during code motion -- every commit diff must show moves only; this is the reviewer's primary check, backed by the green suite.
5. `docs.test.ts` front-matter/index drift -- plan checkboxes and STATUS.md land in the same commit as each task (see global constraints).

## Task 1: Layered directory moves

Pure `git mv` plus import-path rewrites; source names unchanged in this task.

**Files:**
- Move to `src/core/`: `src/selection.ts`, `src/file-range.ts`, `src/search.ts`, `src/store.ts`, `src/message.ts`, `src/transform.ts`
- Move to `src/tui/`: `src/card-chrome.ts`, `src/display.ts`, `src/comment-input.ts`, `src/editor.ts`, `src/path-completion.ts`
- Move to `src/viewer/`: `src/viewer.ts`, `src/viewer-state.ts`, `src/status-line.ts`
- Mirror in `test/`: every `test/<name>.test.ts` whose module moved goes to `test/<layer>/<name>.test.ts`; `test/docs.test.ts` and `test/smoke.test.ts` stay at the root
- Create: `test/architecture.test.ts`, `src/AGENTS.md`
- Modify: `index.ts` (import paths), root `AGENTS.md` (one pointer line)

- [ ] **Step 0: record the baseline**

Run: `node --test "test/**/*.test.ts" 2>&1 | tail -8`
Expected: `pass 366`, `fail 0`. Record the numbers in the task ledger.

- [ ] **Step 1: move the files**

```bash
mkdir -p src/core src/tui src/viewer test/core test/tui test/viewer
git mv src/selection.ts src/file-range.ts src/search.ts src/store.ts src/message.ts src/transform.ts src/core/
git mv src/card-chrome.ts src/display.ts src/comment-input.ts src/editor.ts src/path-completion.ts src/tui/
git mv src/viewer.ts src/viewer-state.ts src/status-line.ts src/viewer/
git mv test/selection.test.ts test/file-range.test.ts test/search.test.ts test/store.test.ts test/message.test.ts test/transform.test.ts test/core/
git mv test/card-chrome.test.ts test/display.test.ts test/comment-input.test.ts test/editor.test.ts test/path-completion.test.ts test/tui/
git mv test/viewer.test.ts test/viewer-state.test.ts test/status-line.test.ts test/viewer/
```

(Adjust the test list to the actual files present; the rule is: each test mirrors its module.)

- [ ] **Step 2: rewrite import paths**

Rules (apply to every `import ... from "<spec>"`):

1. `index.ts`: `./src/<m>.ts` becomes `./src/<layer>/<m>.ts` per the mapping above.
2. Inside `src/core/`: relative imports between core modules stay `./<m>.ts`.
3. Inside `src/tui/`: imports of core modules become `../core/<m>.ts`; imports between tui modules stay `./<m>.ts`.
4. Inside `src/viewer/`: imports of core modules become `../core/<m>.ts`, of tui modules `../tui/<m>.ts`; imports between viewer modules (`viewer.ts`, `viewer-state.ts`, `status-line.ts`) stay `./<m>.ts`.
5. Moved test files: `../src/<m>.ts` becomes `../../src/<layer>/<m>.ts`; unmoved root test files (`docs.test.ts`, `smoke.test.ts`) are untouched.
6. Verify no stale references: `grep -rn '"\.\./src/\(selection\|file-range\|search\|store\|message\|transform\|card-chrome\|display\|comment-input\|editor\|path-completion\|viewer\|viewer-state\|status-line\)\.ts"' index.ts src/ test/` must return nothing, and `grep -rn 'from "\./src/' index.ts` must only show layered paths.

Run: `npx tsc --noEmit` (expected: clean) and `npm test` (expected: 366 pass / 0 fail).
Commit: `refactor(src): group modules into core/, tui/, viewer/ layers`

- [ ] **Step 3: architecture boundary test**

Create `test/architecture.test.ts`.
It walks `src/**/*.ts`, extracts every `from "<specifier>"`, resolves relative specifiers against the importing file, and asserts:

1. Files under `src/core/` import nothing outside `src/core/` except `node:*` builtins; in particular never `@earendil-works/*`.
2. Files under `src/tui/` resolve relative imports only into `src/tui/` or `src/core/`.
3. Files under `src/viewer/` resolve relative imports only into `src/viewer/`, `src/tui/`, or `src/core/` (never the repo-root `index.ts`).
4. Sanity: the scan covers at least the 14 moved modules (guard against an empty walk passing vacuously).

Verification: temporarily add `import { reduceViewer } from "../viewer/viewer-state.ts";` to `src/core/selection.ts`, run the suite and confirm the core-boundary test fails; revert the line.
The file adds exactly 4 tests (three boundary rules plus the scan sanity check).
Run: `npm test` (expected: 370 pass / 0 fail).
Commit: `test(src): enforce module layering with an architecture test`

- [ ] **Step 4: src/AGENTS.md and root pointer**

Create `src/AGENTS.md` with exactly this content:

```markdown
# src/ Module Map

This directory is layered; the dependency direction is one-way: `core <- tui <- viewer <- index.ts`.

## Layers

- `core/` -- pure logic, no host imports (`@earendil-works/*`): selection, file-range, search, store, message, transform.
- `tui/` -- reusable TUI widgets, may import host packages and `core/`: card-chrome, display, comment-input, editor, path-completion.
- `viewer/` -- the annotation viewer feature, may import `core/` and `tui/`: viewer (AnnotateCard shell), state (reducer), movement, search-mode, comment-mode, layout, line-style, status-line.
- `index.ts` (repo root) -- the composition root; the only module that wires layers together.

## Rules

- New pure logic (no TUI) goes to `core/`.
- New reusable widget goes to `tui/`.
- New viewer behavior goes to `viewer/`; mode transitions live in the matching mode module, not in `viewer.ts`.
- Never import upward against the layer direction; `test/architecture.test.ts` enforces this.
- Tests mirror the layout under `test/` (`test/core/`, `test/tui/`, `test/viewer/`).
```

Add one line to root `AGENTS.md` under "Pi extension conventions":

```
- Module layout and dependency rules for `src/` live in `src/AGENTS.md` (auto-loaded when files under `src/` are read).
```

Run: `npm test` (expected: 370 / 0).
Commit: `docs(src): add src/AGENTS.md module map and layering rules`

## Task 2: Viewer monolith split

Code motion only; private helpers become exported solely for use by sibling `viewer/` modules; no re-export barrels.

**Files:**
- Create: `src/viewer/layout.ts`, `src/viewer/line-style.ts`, `src/viewer/state.ts`, `src/viewer/movement.ts`, `src/viewer/search-mode.ts`, `src/viewer/comment-mode.ts`
- Modify: `src/viewer/viewer.ts`, `src/viewer/status-line.ts`, `src/viewer/viewer.test.ts` (extract one section), `index.ts` no change expected
- Delete: `src/viewer/viewer-state.ts`
- Split: `test/viewer/viewer-state.test.ts` into `state.test.ts` / `movement.test.ts` / `search-mode.test.ts` / `comment-mode.test.ts`; create `test/viewer/layout.test.ts`

- [ ] **Step 1: extract `layout.ts` from `viewer.ts`**

Move these to `src/viewer/layout.ts`, each `export`ed: `MIN_VIEWPORT_ROWS`, `CHROME_ROWS`, `MAX_VIEWPORT_ROWS`, `COMMENT_BOX_TITLE`, `PREVIEW_MAX_INNER_ROWS`, `EDITOR_BOX_MAX_WIDTH`, `EDITOR_MAX_INNER_ROWS`, `MARKER_FIELD_WIDTH`, `gutterWidth`, `clampScrollLeft`.
`viewer.ts` imports them from `./layout.ts`.
Run: `npx tsc --noEmit` + `npm test` (370 / 0).
Commit: `refactor(viewer): extract layout constants and helpers`

- [ ] **Step 2: extract `line-style.ts` from `viewer.ts`**

Move these to `src/viewer/line-style.ts`, each `export`ed: `UNDERLINE_ON`, `UNDERLINE_OFF`, `BOLD_ON`, `DIM_ON`, `INTENSITY_OFF`, the `SpanStyle` type, the `StyleSpan` interface, `applyStyleSpans`.
`viewer.ts` imports them from `./line-style.ts`.
`PENDING_ICON`, `CONTINUATION_MARK`, `KITTY_REPEAT`, `normalizeKeyRepeat`, and `AnnotateCard` stay in `viewer.ts`.
Run: `npx tsc --noEmit` + `npm test` (370 / 0).
Commit: `refactor(viewer): extract line styling`

- [ ] **Step 3: split `viewer-state.ts`**

Create from its content, pure motion:

- `src/viewer/movement.ts` (all `export`ed): `HALF_PAGE`, `keepVisible`, `moved`, `consumeCount`, `clearUnusedCount`, `ordinalOf`, `stackAtCursor`, `cycleTarget`, `resetCycleOnMove`.
- `src/viewer/search-mode.ts` (all `export`ed): `repeatSearch`, `incrementalJump`, `submitSearch`, `searchStep`.
- `src/viewer/comment-mode.ts` (all `export`ed): `toCommentKey`, `commentStep`.
- `src/viewer/state.ts`: the types (`ViewerMode`, `ViewerState`, `PendingDraft`, `ViewerEffect`, `ViewerResult`, `ViewerViewport`) plus `handleMode` (stays module-private) and `reduceViewer` (exported).
- Any helper found in `viewer-state.ts` that is not listed above stays in `state.ts`.

Rules:

1. `state.ts` imports the helpers by value from the three mode modules.
2. The mode modules reference viewer-state types exclusively via `import type { ... } from "./state.ts"` -- never a value import from `state.ts` (prevents a runtime cycle).
3. Update importers: `viewer.ts` gets `reduceViewer` from `./state.ts` and `stackAtCursor` from `./movement.ts`; `status-line.ts` gets `ViewerMode` (type-only) from `./state.ts`; `test/viewer/viewer-state.test.ts` updates paths accordingly (it is split in the next step).
4. Delete `src/viewer/viewer-state.ts`; `grep -rn "viewer-state" src/ index.ts test/ --include="*.ts"` must return nothing.

Run: `npx tsc --noEmit` + `npm test` (370 / 0).
Commit: `refactor(viewer): split viewer-state reducer by concern`

- [ ] **Step 4: split the viewer tests**

Split `test/viewer/viewer-state.test.ts` (100 tests, all flat `test(...)` calls) into four files by test-name, applying these rules in order (first match wins, case-insensitive):

1. Name contains `comment` -> `comment-mode.test.ts` (expected 19).
2. Name contains `search`, or starts with `/`, or contains `n/N` -> `search-mode.test.ts` (expected 11).
3. Name matches movement keys/verbs (`h`/`j`/`k`/`l`/`gg`/`g`/`0`/`$` as words, `arrow`, `scroll`, `pgdn`, `pgup`, `ctrl+`, `count`, `stack`, `cycle`, `tab`, `viewport`, `clamp`, `column`, `line`, `page`, `wrap`) -> `movement.test.ts` (expected 48).
4. Everything else -> `state.test.ts` (expected 22).

Hard requirements: the four files total exactly 100 tests; every file imports `reduceViewer` (and types) from `../../src/viewer/state.ts` and `stackAtCursor`/`cycleTarget` from `../../src/viewer/movement.ts` as needed; the shared fixture/setup helpers at the top of the original file are duplicated into each file unchanged.
If a count deviates from the expectation, re-check the grouping against the rules; if the rules themselves mis-classify a name, note the deviation in the commit message.

Then extract the `gutterWidth` section (the `// gutterWidth ---` banner block, 1 test) from `test/viewer/viewer.test.ts` into `test/viewer/layout.test.ts`.

Run: `npm test` -- splitting moves tests between files but adds none, so the expected total stays **370 pass / 0 fail**.
Commit: `test(viewer): mirror the viewer module split in the test layout`

## Final review

- [ ] Broad review pass (fresh reviewer subagent, per subagent-driven-development Phase 5): spec-compliance against every spec section (target layout, dependency rules, non-goals) plus code quality across the full diff; then the controller verifies `npm test` + `npx tsc --noEmit` green and the 370-test total.

## Follow-ups

- After merge to master: delete the worktree, then a courtesy smoke run (`PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`, one annotate flow) -- no TUI behavior changed, so this is not a gate.
- The split enables the deferred viewer work listed in `STATUS.md` (focus race, search vim-parity) to land in small modules.
