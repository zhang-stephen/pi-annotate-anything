# AGENTS.md

Project: **pi-annotate-anything** -- a Pi coding agent extension for annotating arbitrary line/character ranges of any local file, injecting the annotation as a quote block plus comment into the conversation.

## Language rules

1. Default to **English** for all specs, plans, code, comments, commit messages, and documentation.
2. Chinese is allowed only in explicitly designated files (e.g. `README.zh.md`).

## Version control

- Use git for all version management.
- This project is a **Node.js package**; keep `.gitignore` appropriate for Node.js (node_modules, build output, logs, OS/editor files).
- Use **semantic commit messages**, e.g. `feat(<component>): ...`, `fix(<component>): ...`, `chore: ...`, `docs: ...`.

## Character set rules

- Except for UI-related code/strings and Chinese-language files, **no non-ASCII characters** in any file (no smart quotes, em dashes, arrows, emoji, etc.).
- UI-facing strings may use **Nerd Font (NF) icons** where appropriate.

## Markdown formatting

- **No manual line wrapping (hard wrap) in Markdown files.** One paragraph is one line; soft wrapping is the editor/renderer's job. Code blocks, tables, and list-item structure are exempt.

## Pi extension conventions

- The extension is a single TS module with a default export of `function (pi: ExtensionAPI)`; Pi bundles jiti, so no build step is needed.
- Register capabilities via `registerCommand()` / `registerTool()` / `pi.on()` / `ctx.ui`.
- Acquire/release resources in `session_start` / `session_shutdown` handlers, not at the top level of the factory function.
- `package.json` carries `"keywords": ["pi-package"]`.
- Host packages such as `@earendil-works/pi-coding-agent` go in `peerDependencies` with `"*"`, never in `dependencies`.

## Releases

- Versions and changelogs are managed by **release-please**; never bump
  `package.json` `"version"` or edit `CHANGELOG.md` by hand.
- Merging a release PR tags the release and publishes to npm via **trusted
  publishing (OIDC)**; there is no npm token in the repo.

## Progress tracking

- `docs/superpowers/STATUS.md` is the entry point at session start. It is a pure index; the authoritative status of a spec/plan lives in its own YAML front-matter: `status: draft|approved|in-progress|done`, plans also carry `progress: n/m`.
- Specs and plans with `status: done` are NOT read again, unless the current work touches that area.
- Fine-grained progress lives in plan checkboxes (`- [ ]` / `- [x]`).
- When finishing a task or step, update the plan checkboxes AND the front-matter (`status`/`progress`) AND STATUS.md in the same commit as the work.
