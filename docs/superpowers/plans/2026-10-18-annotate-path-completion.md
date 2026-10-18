---
title: /annotate Path Completion - Implementation Plan
status: in-progress
progress: 0/2
spec: ../specs/2026-10-18-annotate-path-completion-design.md
---

# /annotate Path Completion - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add filesystem path completion to the `/annotate <path>` command argument.

**Architecture:** A new pure-ish helper module `src/path-completion.ts` exposes `completePath(argumentPrefix, cwd)` doing all listing/filtering/sorting; `index.ts` wires it into `registerCommand`'s `getArgumentCompletions` callback. All logic is unit-tested with tmp-dir fixtures; the pi API wiring is verified by manual E2E.

**Tech stack:** TypeScript (jiti, no build step), node:fs/node:path/node:os, node --test.

**Spec:** `docs/superpowers/specs/2026-10-18-annotate-path-completion-design.md` (status: approved) - the plan assumes the spec's decisions; implementers read both.

## Global constraints

- All code, comments, test names, and commit messages in English; no non-ASCII characters in files except UI strings.
- Semantic commits (`feat(<component>): ...`).
- Test commands: single file `node --test test/<file>.test.ts`, full suite `npm test`; typecheck `npx tsc --noEmit`.
- Never touch `package.json` `"version"` or `CHANGELOG.md` (managed by release-please).
- Completion semantics verbatim from the spec: directories first with a trailing `/` and `description: "dir"`; files carry no description; dotfiles only when the base part starts with `.`; cap at 100 entries; unreadable directory returns `null`.
- The `getArgumentCompletions` callback receives only `argumentPrefix` (no `ctx`), so the cwd comes from `process.cwd()`.

## Review Focus

1. Prefix ending in `/` right after completing a directory - expect: list that directory's contents with values prefixed by the directory part; pinned by the "prefix ending in a directory" test in Task 1.
2. Case-sensitivity surprise (`al` not matching `Alpha.ts`) - expect: shell-like case-sensitive prefix matching; pinned by the "case-sensitive" test in Task 1.
3. Symlink to a directory - expect: offered by its Dirent type (no trailing `/`, no extra `stat`); pinned by the symlink test in Task 1; documented limitation.
4. Bare `~` without a slash - expect: no home expansion (only `~/...` expands), filters cwd literally and normally yields `[]`; pinned by the bare-tilde assertion in Task 1.
5. `~/` on a minimal environment where home may be nearly empty - expect: never throws, returns an array whose values all start with `~/`; pinned by the loose tilde test in Task 1.

---

### Task 1: completePath helper

**Files:**
- Create: `src/path-completion.ts`
- Test: `test/path-completion.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/path-completion.test.ts`, using `node:test`, `fs.mkdtempSync(path.join(os.tmpdir(), "pi-annotate-pc-"))` per test file setup, and these fixtures in the tmp root: files `alpha.ts`, `alpine.ts`, `beta.ts`, `.hidden`; directory `sub/` containing `inner.ts`; directory `zeta/` (empty); symlink `linkdir` -> `sub` (skip the symlink test on platforms where symlink creation fails).

```ts
test("filters entries by base prefix; files use name as value and label, no description", () => {
  const items = completePath("al", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["alpha.ts", "alpine.ts"]);
  assert.ok(items.every(i => i.description === undefined && i.label === i.value));
});

test("directories sort first and carry a trailing slash plus dir description", () => {
  const items = completePath("", tmp)!;
  assert.deepStrictEqual(items.map(i => i.label), ["sub/", "zeta/", "alpha.ts", "alpine.ts", "beta.ts"]);
  assert.strictEqual(items[0].description, "dir");
});

test("prefix ending in a directory lists its contents with prefixed values", () => {
  const items = completePath("sub/", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["sub/inner.ts"]);
});

test("dotfiles hidden unless base starts with a dot", () => {
  assert.ok(!completePath("", tmp)!.some(i => i.label === ".hidden"));
  assert.deepStrictEqual(completePath(".", tmp)!.map(i => i.label), [".hidden"]);
});

test("case-sensitive prefix matching", () => {
  assert.ok(!completePath("AL", tmp)!.length);
});

test("symlink to a directory is offered by Dirent type, without trailing slash", () => {
  const items = completePath("li", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), ["linkdir"]);
});

test("tilde-slash prefix expands home; bare tilde does not", () => {
  const home = completePath("~/", tmp);
  assert.ok(Array.isArray(home));
  assert.ok(home!.every(i => i.value.startsWith("~/")));
  assert.deepStrictEqual(completePath("~", tmp), []);
});

test("absolute prefix resolves and keeps the absolute directory part in values", () => {
  const items = completePath(path.join(tmp, "sub") + "/", tmp)!;
  assert.deepStrictEqual(items.map(i => i.value), [path.join(tmp, "sub") + "/inner.ts"]);
});

test("missing directory returns null", () => {
  assert.strictEqual(completePath("no-such-dir-anywhere/", tmp), null);
});

test("caps results at 100 entries", () => {
  for (let i = 0; i < 105; i++) fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, "0")}`), "");
  assert.strictEqual(completePath("f", tmp)!.length, 100);
});
```

- [ ] **Step 2: Run the tests, verify failure**

Run: `node --test test/path-completion.test.ts`
Expected: FAIL, "Cannot find module .../src/path-completion.ts"

- [ ] **Step 3: Implement `completePath` in `src/path-completion.ts`**

Signature (import the type from pi-tui, reuse `resolvePath` from `./file-range.ts`):

```ts
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export function completePath(argumentPrefix: string, cwd: string): AutocompleteItem[] | null;
```

Algorithm: split at the last `/` into `dirPart` (kept verbatim for `value` construction, `""` when absent) and `base`; resolve the directory as `dirPart === "" ? cwd : resolvePath(dirPart, cwd)`; `readdirSync(dir, { withFileTypes: true })` inside try/catch returning `null` on throw; keep entries whose name starts with `base`, dropping dotfiles unless `base` starts with `.`; sort directories first then case-insensitive by name; cap at 100; map to `{ value: dirPart + name + (isDir ? "/" : ""), label: name + (isDir ? "/" : ""), description: isDir ? "dir" : undefined }`.

- [ ] **Step 4: Run the tests, verify pass**

Run: `node --test test/path-completion.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/path-completion.ts test/path-completion.test.ts
git commit -m "feat(annotate): add filesystem path completion helper"
```

---

### Task 2: Wire completion into the /annotate command

**Files:**
- Modify: `index.ts` (the `pi.registerCommand("annotate", { ... })` options object)

- [ ] **Step 1: Add the callback**

In `index.ts`, import `completePath` from `./src/path-completion.ts` and add to the `registerCommand` options:

```ts
getArgumentCompletions: (argumentPrefix) => completePath(argumentPrefix, process.cwd()),
```

- [ ] **Step 2: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all tests pass

- [ ] **Step 3: Manual E2E (human confirms)**

Run: `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`, type `/annotate sr<Tab>` (or the completion trigger), drill into a directory with another `<Tab>`, and submit the command on a real file.
Expected: path suggestions appear and complete; the card opens on the completed path.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat(annotate): wire path completion into /annotate command"
```
