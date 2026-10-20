---
title: Src Module Layout - Design
status: draft
---

# Src Module Layout - Design

Date: 2026-10-20
Context: approved design direction from the 2026-10-20 brainstorming session (options A + B combined; adapter-layer option C rejected as YAGNI).

## Problem

`src/` is a flat directory of 14 modules (about 2400 LOC), and the two largest files, `viewer.ts` (731 lines) and `viewer-state.ts` (564 lines), form one tightly coupled modal-viewer unit of about 1300 lines.
The flat layout hides an already-clean dependency structure and gives future features no obvious home, which raises the cost and risk of every addition.

## Goals

1. Make the existing layering explicit: pure core logic, reusable TUI widgets, viewer feature, composition root.
2. Split the viewer monolith along its real seams so future viewer features (new modes, search enhancements) touch small focused files.
3. Add `src/AGENTS.md` so LLM agents get the module layout and dependency rules via progressive disclosure (pi-subdir-context) when working under `src/`.
4. Zero behavior change: this is a move-and-split refactor, verified by the existing test suite staying green at every step.

## Non-goals

- No logic changes, no renames of exported symbols, no API changes.
- No ports-and-adapters layer for host packages (pi-tui / pi-coding-agent keep being imported directly outside `core/`).
- No changes to `index.ts` responsibilities beyond import-path updates; it stays the composition root.

## Current state (verified facts)

Import audit of `src/` on 2026-10-20:

- Pure logic, no pi-tui imports: `selection`, `file-range`, `search`, `store`, `message`, `transform`.
- TUI widgets: `card-chrome`, `display`, `comment-input`, `editor`, `path-completion`, `status-line`.
- `status-line.ts` is imported only by `viewer.ts` (the mention in `card-chrome.ts` is a comment); it imports types from `card-chrome` and `viewer-state`.
- `viewer-state.ts` is already a pure reducer module: state types plus `reduceViewer`/`handleMode` and helpers, with seams at movement/scroll/count, stack cycling, search-mode transitions, and comment-mode transitions.
- `viewer.ts` is the Component shell (`AnnotateCard`) plus line styling, layout constants, and kitty key-repeat normalization.

## Target layout

```
index.ts                       -- composition root, the only cross-layer assembler
src/
  AGENTS.md                    -- module map and dependency rules (progressive disclosure)
  core/                        -- pure logic; no pi-tui, no upper layers
    selection.ts  file-range.ts  search.ts
    store.ts      message.ts     transform.ts
  tui/                         -- reusable TUI widgets; may depend on core only
    card-chrome.ts  display.ts   comment-input.ts
    editor.ts       path-completion.ts
  viewer/                      -- annotation viewer feature; may depend on core and tui
    viewer.ts        -- AnnotateCard shell: render assembly, focus, key ingress, effect execution, marker icons
    state.ts         -- ViewerState/ViewerResult/ViewerEffect types, reduceViewer, handleMode (was viewer-state.ts)
    movement.ts      -- moved, keepVisible, count handling, stack cycling (stackAtCursor/cycleTarget/ordinalOf)
    search-mode.ts   -- searchStep, repeatSearch, incrementalJump, submitSearch
    comment-mode.ts  -- toCommentKey, commentStep
    layout.ts        -- viewport/chrome/editor constants, gutterWidth, clampScrollLeft
    line-style.ts    -- SpanStyle, applyStyleSpans, ANSI constants
    status-line.ts   -- moved from src/ (viewer-only)
test/                          -- mirrors src/ structure (core/, tui/, viewer/); docs.test.ts and smoke.test.ts stay at the root
```

`normalizeKeyRepeat` and the kitty repeat regex stay in `viewer.ts` (key ingress is a shell concern).
`PENDING_ICON`/`CONTINUATION_MARK` stay in `viewer.ts` (gutter marker rendering).

## Dependency rules

1. `src/core/**` must not import `@earendil-works/*` and must not import outside `core/`.
2. `src/tui/**` may import host packages and `core/`, never `viewer/` or `index.ts`.
3. `src/viewer/**` may import `core/`, `tui/`, and host packages.
4. `index.ts` may import anything.

Enforced by a new `test/architecture.test.ts` that scans import statements under `src/` and asserts rules 1-3, so the layering cannot silently regress.

## src/AGENTS.md

New file, loaded automatically by pi-subdir-context when an agent reads files under `src/`.
Contents: the layer table above, the dependency rules, a "where does new code go" guide (new pure logic to `core/`, new reusable widget to `tui/`, new viewer behavior to `viewer/`, wiring to `index.ts`), and the test-mirror convention.
Root `AGENTS.md` gains a one-line pointer to it under "Pi extension conventions".

## Execution

- Work happens in worktree `.pi/worktrees/src-module-layout/` per AGENTS.md; merged back to master after review.
- One plan, two tasks:
  - Task 1 (option A): directory moves via `git mv`, import-path updates, test mirror moves, `src/AGENTS.md`, root AGENTS.md pointer, `test/architecture.test.ts`.
  - Task 2 (option B): split `viewer.ts`/`viewer-state.ts` into the `viewer/` modules listed above; split `viewer.test.ts`/`viewer-state.test.ts` along the same seams.
- Task 1 lands and is verified green before Task 2 starts, so import paths are stable when the split happens.
- Semantic commits, type `refactor(src)`; no version or CHANGELOG edits (release-please).

## Verification

- `npm test` and `npx tsc --noEmit` green after every move/split step.
- `test/architecture.test.ts` fails if a layering violation is introduced (prove by a temporary violation during development, then revert).
- Packaging unaffected: `package.json` `files` covers `src/` wholesale.
- No TUI-facing change, so no manual E2E gate; a smoke annotate flow in the sandbox (`PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`) is a courtesy check after merge.

## Risks

- Task 2 moves about 1300 lines of coupled code; mitigated by landing Task 1 first and keeping the split to pure code motion with the existing tests as the net.
- Import-cycle risk between `viewer/` modules (state vs. mode helpers); mitigated by keeping types in `state.ts` and letting mode modules depend on it one-way.
