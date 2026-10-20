---
title: Fuzzy Path Completion + Viewer Search Vim Parity -- Design
status: approved
---

# Fuzzy Path Completion + Viewer Search Vim Parity -- Design

## Summary

Two unrelated improvements batched into one spec/plan by user decision (2026-10-20):

- **Part A**: upgrade `/annotate` path completion from prefix matching to fuzzy matching, backed by a workspace file index that is built asynchronously (so TUI rendering is never blocked) and held in a single in-memory slot for the current workspace; no database, no persistence (see "Workspace index").
- **Part B**: three vim-parity fixes for viewer search/navigation, two of which amend the contract of `2026-10-18-viewer-search-design.md`.

The parts touch disjoint modules (`tui/path-completion.ts` + a new `core/` module vs `viewer/state.ts` + `core/search.ts`) and share only the execution vehicle.

## Part A: Fuzzy path completion

### Current state

`src/tui/path-completion.ts` (54 lines) lists one directory with `fs.readdirSync` and filters by `String.startsWith` on the typed base fragment.
There is no workspace-wide completion: without a slash the user can only complete top-level entries of the session cwd, one directory at a time.

### Goals (A)

- **A1**: a non-empty query with no slash (e.g. `/annotate con`) fuzzy-matches against all files of the session workspace, presented through the existing autocomplete dropdown.
- **A2**: a query with a slash (e.g. `/annotate src/comp`) fuzzy-matches the base fragment against entry names of the fixed directory part (non-recursive).
- **A3**: an empty query (the user just typed `/annotate `) keeps today's directory-browsing behavior unchanged; A1 applies only once the query is non-empty.
- **A4**: the file index is enumerated asynchronously by the fallback chain `git ls-files` -> `fd` -> bounded walk, warmed when `/annotate` argument completion is first requested, cached per session with a TTL, and capped.
- **A5**: on a host pi-tui too old to export the fuzzy helpers, the extension reports an explicit error and does not register the completion feature; it never silently degrades.

### Non-goals (A)

- No fzf-style overlay or any new UI component; the dropdown stays the host's autocomplete rendering.
- No async indexer beyond the warm-up model defined below (no file watchers, no persistent on-disk index, no background refresh without a completion call).
- No multi-root workspaces; the single session cwd is the only index root.
- No fuzzy matching of line-range suffixes or anything after the file argument.
- No changes to `package.json` peer ranges (pi requires `*`).

### Design (A)

#### Query scope rules

`completePath(argumentPrefix, cwd)` splits at the last `/` as today:

1. **Empty prefix** (`argumentPrefix === ""`): unchanged; list cwd entries, directories first, prefix filter trivially passes.
2. **Prefix contains a slash**: `dirPart` is resolved verbatim as today; the `base` fragment is matched with `fuzzyMatch` against entry names of that single directory (non-recursive).
   Directories are still grouped before files; within each group, order by fuzzy score instead of alphabetical.
3. **No slash, non-empty**: fuzzy-match against the workspace index (below); `fuzzyFilter` ranks by score; results are capped at `MAX_ITEMS` (100) as today.
   While the index is `building` / `oversized` / `failed`, this rule falls back to rule 1 behavior for the duration.
   Directory candidates are included (value suffixed with `/`) so the user can drill into a directory without typing its full path.

Dotfile rule: entries whose name starts with `.` stay hidden unless the query starts with `.`, per scope; this applies to both the directory listing and the index (the index excludes dotfiles at enumeration time unless the query starts with `.` -- implemented as a post-filter on cached entries so the cache itself is query-independent).

#### Workspace index

- Root: the session cwd passed into `completePath`.
- Storage: a module-level `Map<string, IndexEntry>` where `IndexEntry = { state: "building" | "ready" | "oversized" | "failed"; entries: string[]; enumerator: "git" | "fd" | "walk" | null; at: number }`; the map lives and dies with the extension process (per session).
- Warm-up: the first argument-completion call for a root with no entry kicks off asynchronous enumeration (`child_process.spawn`, never `spawnSync`) and immediately serves directory-browsing results; once enumeration finishes, the entry flips to `ready`/`oversized`/`failed` and later calls use the index.
- TTL and refresh: entries older than 5,000 ms are stale; the next completion call keeps serving the stale entries and kicks off one background refresh (stale-while-revalidate); only one build per root is ever in flight.
- Enumeration chain, first success wins, and the winning enumerator is memoized in the entry so refreshes skip re-probing:
  1. `git ls-files -z --cached --others --exclude-standard` in the root (tracked + untracked, gitignore-respected); directory entries are derived synthetically as all ancestor paths of the listed files.
  2. `fd --type f --type d` in the root (fd's defaults skip `.git` and respect `.gitignore`); no upfront dependency check is performed -- a missing `fd` is detected by spawn failure at probe time and simply advances the chain, and the memoized enumerator means the probe cost is paid at most once per root per session.
  3. Bounded recursive walk skipping `.git`, `node_modules`, `dist`, `build`, with depth cap 8.
- Cap: 20,000 entries. If enumeration exceeds the cap, the entry becomes `oversized` and no-slash queries fall back to empty-query behavior (directory browsing of cwd).
- A root where all three enumerators fail becomes `failed` and behaves like `oversized`.

#### Host version floor and explicit failure

`fuzzyMatch` / `fuzzyFilter` are exported from `@earendil-works/pi-tui`'s `dist/fuzzy.js`; tarball inspection (2026-10-20) confirms they exist in every published pi-tui from 0.99.0 through 1.3.0.
Recommended host: **pi >= 1.0** (pi-tui >= 1.0.0), documented in README.
Because peer ranges must stay `*`, the extension feature-detects in `session_start`: if `fuzzyFilter` is not a function (possible under jiti's CJS interop where a missing named export is `undefined`), the extension surfaces an explicit error notification naming the minimum host version and does not register the `/annotate` argument-completion feature at all; silent fallback to prefix matching is forbidden.

### Testing (A)

- Unit tests with `node:test` against `fs.mkdtemp` fixture trees: all three scope rules, dotfile visibility, directory grouping, `MAX_ITEMS` cap, `oversized` fallback, warm-up serving browsing results while `building`, stale-while-revalidate refresh (injected `now()` and stubbed async spawn), enumerator memoization, enumeration chain order, and the explicit-failure path (stubbed missing `fuzzyFilter` -> error reported, completion not registered).
- Anchor: suite must stay green at the pre-feature count plus the new tests (baseline at plan time: 370 pass).

## Part B: Viewer search vim-parity

### Current state

From the deferred backlog (STATUS.md 2026-10-19 entry, review minors of the viewer-search feature):

1. Arrow keys move one cell and leave a pending count armed; vim treats arrows as motions, so `5` then `<Down>` should move five lines and consume the count (`src/viewer/state.ts` arrow cases lack the `(state.count ?? 1)` multiplier and the `consumeCount` wrapper that `h`/`j`/`k`/`l` have).
2. A digit pressed while a `g` two-stroke is pending arms the count; vim discards the unmatched prefix key instead.
3. `findMatches` loops forever on a non-global regex (`re.lastIndex` never advances); `jumpTarget` misbehaves for `count <= 0`; both are exported from `core/search.ts` but only ever called with well-formed inputs today (defense in depth).

### Goals (B)

- **B1**: arrow keys apply and consume a pending count exactly like `h`/`j`/`k`/`l`.
- **B2**: a digit pressed during a pending `g` clears `pending` and is swallowed (no count armed); other non-`g` keys keep today's fall-through.
- **B3**: `findMatches` upgrades a non-global regex to global internally; `jumpTarget` treats `count < 1` as `1`.

### Amendment recording (B)

B1 deprecates one bullet in `docs/superpowers/specs/2026-10-18-viewer-search-design.md` (the count-consumer list, its line 86).
Per SDD amendment discipline, that bullet is struck through in place with a reason and a pointer to this spec; the replacement contract lives here:

- `count` is consumed and cleared by `n`/`N`, `j`/`k`, `h`/`l`, the four arrow keys (applied to the motion), and `G`; any other key clears it without effect.

B2 adds a new clause the old spec never specified (its `{count}gg` remains a Future item and is not implemented here); no strikethrough is needed for B2.
B3 changes no user-visible contract; no amendment.

### Testing (B)

- `test/viewer/state.test.ts` (or the movement file per the split): `5` + each arrow moves five cells and clears the count; digit-during-pending-`g` clears `pending` and arms no count; `g` then non-digit still falls through.
- `test/core/search.test.ts`: `findMatches` with a hand-built non-global regex terminates and matches; `jumpTarget` with `count = 0` and `count = -3` behaves as `count = 1`.

## Execution constraints

- One plan (`plans/2026-10-20-fuzzy-completion-search-parity.md`), one worktree under `.pi/worktrees/`, semantic commits, review gate per task.
- Subagent workflow as ratified: worker (glm-5.3-flash) implements with red-green gates, reviewer (glm-5.3) reviews, controller owns all `docs/superpowers/` bookkeeping as separate commits.
- Verification via `node --test "test/**/*.test.ts"` and `npx tsc --noEmit` (never `npm test`, which is flaky here).
- ASCII-only source and docs; Nerd Font icons only in UI-facing strings.
- README gains one line documenting the recommended host floor (pi >= 1.0) for fuzzy completion.

## Risks

- While the index is still `building`, early no-slash queries get browsing results instead of fuzzy ones; acceptable warm-up window, bounded by enumeration time.
- `git ls-files` output for a repo with many untracked build artifacts could surprise users who expected only tracked files; `--exclude-standard` (gitignore) keeps this sane.
- The B1 amendment changes a shipped behavior; it is a one-line spec delta and its blast radius is the four arrow cases in `viewer/state.ts`.
