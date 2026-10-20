---
title: Fuzzy Path Completion + Viewer Search Vim Parity - Implementation Plan
status: in-progress
progress: 0/4
spec: ../specs/2026-10-20-fuzzy-completion-search-parity-design.md
---

# Fuzzy Path Completion + Viewer Search Vim Parity - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers-zh:subagent-driven-development (controller side) or superpowers-zh:executing-plans (worker side).
> Steps use checkbox syntax `- [x]` for tracking.

**Goal:** implement the approved spec `2026-10-20-fuzzy-completion-search-parity-design.md`: fuzzy workspace path completion for `/annotate` (Part A) plus three vim-parity fixes for the viewer (Part B).
**Architecture:** new pure module `src/core/file-index.ts` (node-only async enumeration + single-slot cache); `src/tui/path-completion.ts` gains fuzzy scope rules; `index.ts` gates completion registration on a fuzzy feature-detect; viewer changes are confined to `src/viewer/state.ts` and `src/core/search.ts`.
**Tech stack:** TypeScript, `module: nodenext` (import specifiers keep the `.ts` extension), node:test.
**Spec:** `docs/superpowers/specs/2026-10-20-fuzzy-completion-search-parity-design.md` (approved).
**Execution:** worktree `.pi/worktrees/fuzzy-completion-search-parity/` (branch `feat/fuzzy-completion-search-parity`); worker model `zai-coding-cn/glm-5.3-flash`, reviewer model `zai-coding-cn/glm-5.3`, controller is the main session.

## Global constraints

- Baseline: **370 pass / 0 fail** (`node --test "test/**/*.test.ts"`, `npx tsc --noEmit` clean; recorded on master 2026-10-20). Each task ends with the baseline plus its own new tests; estimates below are estimates, the worker records actuals.
- Behavior change is allowed ONLY for spec items B1 (arrow keys consume counts) and B2 (digit during pending `g`); everything else must be additive or zero-change.
- Verify with `node --test "test/**/*.test.ts"` and `npx tsc --noEmit`; never `npm test` (flaky wrapper here).
- Semantic commits of type `feat(core)` / `feat(tui)` / `fix(core)` / `fix(viewer)` / `test(...)` / `docs(...)`; never touch `package.json` version or `CHANGELOG.md`.
- ASCII only in all files (UI strings with Nerd Font icons excepted); Markdown is one sentence per line.
- Bookkeeping convention (ratified 2026-10-20): worker and reviewer NEVER touch `docs/superpowers/`; the controller lands plan checkboxes, front-matter `progress`, STATUS.md, and the Part-B spec amendment as a separate docs commit after each task's review passes.
- Task 3 adds a core module: `test/architecture.test.ts`'s module-map sanity list must be updated in the same commit (19 -> 20 modules), and `src/AGENTS.md`'s layer description must mention `file-index.ts`.

## Review Focus

The five most likely hazards:

1. Async enumeration races: two builds in flight, or an unhandled rejection from a failed spawn reaching the host -- Task 3's single-in-flight guard and promise-error handling are the reviewer's primary check, backed by stubbed-spawn tests.
2. The feature-detect must actually be reachable: a named `import { fuzzyFilter }` can fail at ESM link time instead of yielding `undefined`; use `import * as tui from "@earendil-works/pi-tui"` and probe `tui.fuzzyFilter` (or an equivalent link-safe form) so Task 4's gate can never crash module load.
3. Count-consumption regressions: arrows must apply and consume a pending count but behave exactly as today when no count is pending; the pending-`g` swallow must not eat digits typed in normal (non-pending) mode.
4. Ranking determinism: equal fuzzy scores need a stable tiebreak (path order as enumerated) so tests and UX are reproducible.
5. Silent scope-rule mixing: the slash/non-slash/empty branches must stay mutually exclusive per the spec table; tests pin each branch.

## Task 1: `core/search.ts` hardening (spec B3)

Defense in depth for exported helpers; no caller changes.

**Files:** modify `src/core/search.ts`; modify `test/core/search.test.ts`.

- [ ] **Step 0: record the baseline**

Run: `node --test "test/**/*.test.ts" 2>&1 | tail -8`
Expected: `pass 370`, `fail 0`. Record actuals.

- [ ] **Step 1: red -- failing tests**

`findMatches` with a hand-built non-global regex (`new RegExp("x", "i")`) terminates and returns the same matches as the global form; `jumpTarget` with `count = 0` and `count = -3` behaves exactly as `count = 1`.
Run the file's tests; the new cases must fail (hang guard: run with a timeout; a hang proves the bug).

- [ ] **Step 2: green -- implement**

In `findMatches`, if `re.global` is false, rebuild as `new RegExp(re.source, re.flags + "g")` before iterating.
In `jumpTarget`, treat `count < 1` as `1`.
Full suite + `npx tsc --noEmit` green; commit `fix(core): harden findMatches/jumpTarget against degenerate inputs`.

- [ ] **Step 3: controller bookkeeping** (controller, after reviewer approval)

Tick Task 1, `progress: 1/4`, commit `docs(superpowers)`.

## Task 2: viewer state vim parity (spec B1 + B2)

**Files:** modify `src/viewer/state.ts`; modify `test/viewer/movement.test.ts` and/or `test/viewer/state.test.ts` per where the cases live.

- [ ] **Step 1: red -- failing tests**

`5` then each of the four arrow escape sequences (`\x1b[D/C/B/A`) moves five cells and clears `count` (mirror the existing `h`/`j`/`k`/`l` count tests); digit during pending `g` clears `pending` and leaves `count` undefined; `g` then a non-digit key still falls through as today; arrows with no pending count move exactly one cell (regression pin).

- [ ] **Step 2: green -- implement**

Arrow cases in `handleMode` apply `(state.count ?? 1)` and wrap with `consumeCount`, mirroring the `h`/`j`/`k`/`l` cases.
The pending-`g` dispatch swallows digits (clear `pending`, return state unchanged otherwise).
Full suite + tsc green; commit `fix(viewer): vim parity for counts on arrows and digits during pending g`.

- [ ] **Step 3: controller bookkeeping** (controller, after reviewer approval)

Tick Task 2, `progress: 2/4`; land the spec amendment: strike through the count-consumer bullet in `docs/superpowers/specs/2026-10-18-viewer-search-design.md` (its line 86) with a reason and a pointer to the new spec; commit `docs(superpowers)`.

## Task 3: `core/file-index.ts` workspace index (spec Part A index)

**Files:** create `src/core/file-index.ts` and `test/core/file-index.test.ts`; modify `test/architecture.test.ts` (module map 19 -> 20) and `src/AGENTS.md` (core layer gains `file-index.ts`).

- [ ] **Step 1: API sketch + red tests**

Export an async-aware query API along these lines (worker may refine names, keeping the seam injectable):

```ts
type IndexState = "building" | "ready" | "oversized" | "failed";
interface FileIndex { query(root: string, now: number): { state: IndexState; entries: string[] } }
```

Behavior under test (stubbed `spawn` and injected `now`): chain order git -> fd -> walk; winner memoized (second build skips probing); over-20k enumeration -> `oversized`; `building` returns current (possibly empty) entries while exactly one build is in flight; stale entries (> 5000 ms) are served while one background refresh runs; all-enumerators-fail -> `failed`.
Write failing tests first.

- [ ] **Step 2: green -- implement**

Single-slot cache `{ root, state, entries, enumerator, at }`; async enumeration via `child_process.spawn` only; errors land in the entry state, never as unhandled rejections; the walk skips `.git`/`node_modules`/`dist`/`build`, depth cap 8; synthetic directory entries derived from file paths.
Deterministic ordering: entries are stored in enumeration order (stable tiebreak source for fuzzy ranking).
Full suite + tsc green; commit `feat(core): async workspace file index with SWR cache`.

- [ ] **Step 3: controller bookkeeping** (controller, after reviewer approval)

Tick Task 3, `progress: 3/4`, commit `docs(superpowers)`.

## Task 4: fuzzy completion wiring + registration gate (spec Part A rules + floor)

**Files:** modify `src/tui/path-completion.ts`, `index.ts`, `README.md` (one line: recommended host pi >= 1.0 for fuzzy completion); modify `test/tui/path-completion.test.ts`.

- [ ] **Step 1: red tests for scope rules**

Fixture trees via `fs.mkdtemp`: empty query lists cwd (unchanged); slash query fuzzy-matches within the fixed directory (dirs first, then files, each group by fuzzy score); non-empty no-slash query fuzzy-matches the index with directories included as `/`-suffixed candidates; dotfiles hidden unless query starts with `.`; `MAX_ITEMS` cap respected; `building`/`oversized`/`failed` index states fall back to empty-query browsing.
Equal-score tiebreak follows enumeration order.

- [ ] **Step 2: green -- implement scope rules**

Rewrite `completePath` per the spec's three scope rules, using `fuzzyMatch`/`fuzzyFilter` probed via a link-safe namespace import; expose a `fuzzyAvailable`-style flag from the module.

- [ ] **Step 3: registration gate**

In `index.ts` `session_start`: if fuzzy helpers are unavailable, surface an explicit error notification naming the minimum host version (pi >= 1.0) and skip registering the `/annotate` argument completion; never fall back to prefix matching silently.
Add a seam test for both branches (available / unavailable) with stubbed `ctx.ui`.
README one-liner. Full suite + tsc green; commit `feat(tui): fuzzy path completion with workspace index`.

- [ ] **Step 4: controller bookkeeping** (controller, after reviewer approval)

Tick Task 4, `progress: 4/4`, commit `docs(superpowers)`.

## Final review

- [ ] Broad review pass (fresh reviewer subagent, per subagent-driven-development Phase 5): spec-compliance against every spec section (Part A scope rules, index design, dependency policy, Part B amendments and their recording) plus code quality across the full diff; then the controller verifies `node --test` + `npx tsc --noEmit` green, updates STATUS.md (plan/spec to Done), and presents the branch for merge approval.

## Follow-ups

- Manual E2E in a real terminal by the user: `/annotate` fuzzy completion UX (warm-up window, ranking feel) and the viewer count/arrow parity -- terminal-dependent behavior cannot be covered by unit tests.
- The deferred items (card focus race, search vim-parity leftovers beyond B1-B3 if any surface, E2E automation spec) remain parked in STATUS.md.
