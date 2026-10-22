# AGENTS.md -- docs/superpowers (SDD documents)

Discipline for the spec/plan documents in this directory. Auto-loaded by pi-subdir-context when files here are read.

## Reading discipline

- Session start: read `STATUS.md` only -- it is a pure index, so do not read any spec/plan upfront.
- A document's own YAML front-matter is authoritative; `STATUS.md` is a derived view (kept in sync by the same commit, verified by `test/docs.test.ts`).
- Open a spec/plan only when it is Active (`draft`/`approved`/`in-progress`) and relevant to the current work, or when the work touches an area a `done` document covers.
- When implementing a plan, read the plan (checkboxes) and its linked spec (`spec:` field) -- not other specs.

## Naming

- Specs: `specs/YYYY-MM-DD-<slug>-design.md`; plans: `plans/YYYY-MM-DD-<slug>.md`; a spec and its plan share the same `<slug>`. When a spec is split into multiple plans, later plans extend the slug (`<slug>-phase2.md`, ...).

## Front-matter schema

- Every spec/plan: `title` (equals the document's H1) and `status` (`draft` | `approved` | `in-progress` | `done` | `superseded`).
- Plans also carry `progress: n/m` and `spec: <relative path>` (`spec: none` only for plan-only work).
- Specs carry `plan:` once a plan exists; `status: done` requires it. A spec split into multiple execution phases lists them as a YAML block sequence in execution order (`plan:` followed by indented `- <path>` lines); every listed plan must link back via its `spec:` field.
- `status: superseded` requires `superseded-by: <relative path>`.
- No `created`/`updated` fields: the filename carries the date and git carries the history.
- `STATUS.md` has no front-matter by design.
- All of this is enforced by `test/docs.test.ts`; run `npm test` after editing front-matter.

## Status lifecycle

- Spec: `draft` -> (user approves) `approved` -> (plan executing) `in-progress` -> `done`.
- Plan: created as `in-progress` with `progress: 0/m`; checkboxes (`- [ ]` / `- [x]`) tick as tasks land; `done` at `m/m`.
- When finishing a task or step, update the plan checkboxes AND the front-matter AND `STATUS.md` in the same commit as the work.
- `STATUS.md` `Done` entries are path-only, never detail sub-bullets; completion details live in the plan document and git history.

## Amendments

- Post-merge decision changes are recorded by striking through the deprecated decision, with a reason -- never rewrite approved history silently.
- A plan that changes after merge gets an "Amendment (post-merge)" section summarizing what was removed and where the replacement decision lives.
- SDD ledgers under `.superpowers/sdd/` are gitignored, ephemeral execution state; a worktree ledger is deleted with the worktree -- the plan document is the durable record.
