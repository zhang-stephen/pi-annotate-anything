# AGENTS.md

Project: **pi-annotate-anything** -- a Pi coding agent extension for annotating
arbitrary line/character ranges of any local file, injecting the annotation as
a quote block plus comment into the conversation.

## Language rules

1. Default to **English** for all specs, plans, code, comments, commit
   messages, and documentation.
2. Chinese is allowed only in explicitly designated files (e.g.
   `README.zh.md`).

## Version control

- Use git for all version management.
- This project is a **Node.js package**; keep `.gitignore` appropriate for
  Node.js (node_modules, build output, logs, OS/editor files).
- Use **semantic commit messages**, e.g. `feat(<component>): ...`,
  `fix(<component>): ...`, `chore: ...`, `docs: ...`.

## Character set rules

- Except for UI-related code/strings and Chinese-language files, **no
  non-ASCII characters** in any file (no smart quotes, em dashes, arrows,
  emoji, etc.).
- UI-facing strings may use **Nerd Font (NF) icons** where appropriate.

## Pi extension conventions

- The extension is a single TS module with a default export of
  `function (pi: ExtensionAPI)`; Pi bundles jiti, so no build step is needed.
- Register capabilities via `registerCommand()` / `registerTool()` /
  `pi.on()` / `ctx.ui`.
- Acquire/release resources in `session_start` / `session_shutdown` handlers,
  not at the top level of the factory function.
- `package.json` carries `"keywords": ["pi-package"]`.
- Host packages such as `@earendil-works/pi-coding-agent` go in
  `peerDependencies` with `"*"`, never in `dependencies`.

## Progress tracking

- `docs/superpowers/STATUS.md` is the entry point at session start: read it
  before opening any spec or plan.
- Specs and plans marked `done` in STATUS.md are NOT read again, unless the
  current work touches that area.
- Fine-grained progress lives in plan checkboxes (`- [ ]` / `- [x]`).
- When finishing a task or step, update the plan checkboxes AND STATUS.md in
  the same commit as the work.
