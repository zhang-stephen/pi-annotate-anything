# AGENTS.md

Project: **pi-annotate-anything** -- a Pi coding agent extension for annotating arbitrary line/character ranges of any local file, injecting the annotation as a quote block plus comment into the conversation.

## Language policy

1. Default to **English** for all specs, plans, code, comments, commit messages, and documentation.
2. Chinese is allowed only in explicitly designated files (e.g. `README.zh.md`).

## Review gates

Nothing is committed before the user reviews the artifact.
The workflow is spec -> plan -> code, and every step is gated:

1. **Spec**: written -> user reviews -> only then committed.
2. **Plan**: written -> user reviews -> only then committed.
3. **Code**: implemented -> unit tests and typecheck green -> user confirms manual E2E (TUI-facing changes) -> only then committed.
4. **Docs** (including this file): treated like specs and plans -- user review before commit.

## Version control

- Use git for all version management.
- Use **semantic commit messages**, e.g. `feat(<component>): ...`, `fix(<component>): ...`, `chore: ...`, `docs: ...`.
- This project is a **Node.js package**; keep `.gitignore` appropriate for Node.js (node_modules, build output, logs, OS/editor files).
- Multi-task feature work happens in a worktree under `.pi/worktrees/<slug>/` (gitignored, removed after merge).
- Small fixes may go directly on master; the review gates above still apply.

## Character set rules

- Except for UI-related code/strings and Chinese-language files, **no non-ASCII characters** in any file (no smart quotes, em dashes, arrows, emoji, etc.).
- UI-facing strings may use **Nerd Font (NF) icons** where appropriate.

## Markdown formatting

- **One sentence per line**: consecutive lines form a single paragraph (soft breaks), so never hard-wrap mid-sentence.
- Separate paragraphs with a blank line (a real paragraph break) -- never with trailing spaces or `<br>`.
- Code blocks, tables, and list-item structure are exempt.

## Local testing

- Unit tests: `npm test` (`node --test`); typecheck: `npx tsc --noEmit` -- both must be green before claiming completion.
- Manual E2E (keep the sandbox minimal): an isolated agent home plus the local extension, nothing more -- `PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`.
- E2E fixtures (long lines, CJK, CRLF, tabs) live in /tmp, not in the repo.
- Terminal-dependent behavior (e.g. kitty key repeat) can only be verified in a real terminal, never via tmux or unit tests -- flag it explicitly for the user's E2E pass.

## Pi extension conventions

- The extension is a single TS module with a default export of `function (pi: ExtensionAPI)`; Pi bundles jiti, so no build step is needed.
- Register capabilities via `registerCommand()` / `registerTool()` / `pi.on()` / `ctx.ui`.
- Acquire/release resources in `session_start` / `session_shutdown` handlers, not at the top level of the factory function.
- `package.json` carries `"keywords": ["pi-package"]`.
- Host packages such as `@earendil-works/pi-coding-agent` go in `peerDependencies` with `"*"`, never in `dependencies`.

## Releases

- Versions and changelogs are managed by **release-please**; never bump `package.json` `"version"` or edit `CHANGELOG.md` by hand.
- Merging a release PR tags the release and publishes to npm via **trusted publishing (OIDC)**; there is no npm token in the repo.

## Specs and plans

- SDD documents live in `docs/superpowers/`; their discipline (STATUS.md protocol, front-matter schema, naming, amendments) is defined in `docs/superpowers/AGENTS.md`, which pi-subdir-context auto-loads when files under that directory are read.
- Session entry point for status: `docs/superpowers/STATUS.md` (index only).
