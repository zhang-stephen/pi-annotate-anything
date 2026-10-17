# CI TUI E2E - Design

Status: draft (awaiting approval)
Date: 2026-10-17
Follow-up to: 2026-10-17-annotate-card-chrome-design.md

## Problem

TUI behavior of the annotate extension (card rendering, key handling, pill lifecycle, payload expansion) is currently verified only by manual e2e rounds in the user's terminal.
Manual rounds are slow, depend on one specific terminal setup, and have already missed a whole defect class (kitty-protocol Esc delivery) that unit tests cannot see.
We want the e2e scenarios to run unattended on every push, with no API keys and no model cost.

## Approach

Drive the real pi binary inside a detached tmux session (a true pty) from a Node harness, inject keystrokes with `tmux send-keys`, and assert on two observability layers: `tmux capture-pane -e` (screen text plus raw ANSI for color/style checks) and the pi session JSONL (the exact message payload the model receives).

Sending a message normally requires a live model.
To stay offline and deterministic, the harness loads a second, test-only extension that registers a mock model provider via `pi.registerProvider()`; its models stream a fixed canned response without any network I/O.
Launching pi with `--model mock/test` (exact flag verified during implementation) makes every send complete locally.
The annotate extension's input-transform fires before the provider call, so the session JSONL captures the fully expanded payload.

## Harness layout

- `test/e2e/run.mjs` - scenario runner with helpers: `launchPi({ extensions, cwd })`, `sendKeys(...)`, `waitFor(pattern, { timeout })` (polls capture-pane), `screen()` (raw), `screenText()` (ANSI stripped), `sessionPayload()` (newest session JSONL parsed for the last user message text). Each scenario is an async function; failures print a screen dump.
- `test/e2e/mock-provider.ts` - registers provider `mock` with one model `test` that echoes a fixed string. Loaded only in e2e launches.
- Fixtures: reuse the existing e2e fixtures (ascii.ts, wide.go with tabs and wide chars, crlf.txt, oversized and binary files).

## Scenario coverage

Port every headlessly-assertable scenario from the card-chrome plan and the MVP checklist:

1. Card chrome: border rows, embedded title with path and pending count, footer hints and mode badges per mode, no bleed-through (every row uniform width with background ANSI).
2. Keys: hjkl/0/$, gg/G, ctrl+d/u, v/V/o, c with pre-fill in edit mode, x delete, p preview toggle, Esc layering (legacy escape delivery only).
3. Floating comment box: placement below, flip above near the bottom, right-edge clamping; preview box appears/dismisses with cursor movement.
4. Pill lifecycle: paste, inverse-video recolor (assert `\x1b[7m` around the token), deletion prunes the draft, expansion on send (payload in session JSONL carries quote blocks plus comments), foreign bracket text passes through untouched.
5. Refusals: oversized and binary files notify with an error; CRLF content normalizes.

Explicit gaps (asserted only in local manual checks, documented in the harness README): kitty-keyboard-protocol Esc delivery (tmux does not speak kitty), and theme aesthetics under custom themes such as zentui (colors come from tokens and can be asserted, taste cannot).

## CI workflow

`package.json` gains the `files` allowlist for publishing (see Package contents).

`.github/workflows/e2e.yml`: `ubuntu-latest` (tmux preinstalled), `actions/setup-node` with Node 26 (type stripping for the extension and harness), `npm ci`, `npm install --no-save @earendil-works/pi-coding-agent` (the extension's peer), then `node test/e2e/run.mjs`.
On failure, upload the captured screen dumps and session JSONL as artifacts.
One automatic retry of the scenario suite to absorb pty timing flakes; `waitFor` polling with explicit timeouts is the primary defense.

## Non-goals

- Windows/macOS runners (tmux pty behavior on ubuntu is the single target).
- Performance or rendering benchmarks.
- Keyboard-protocol coverage beyond legacy escape sequences.
- Publishing or release automation.

## Package contents

Publishing is an npm package whose runtime is plain TypeScript loaded by jiti, so the tarball must contain exactly the runtime set and nothing else.
Use a package.json `files` allowlist: `["index.ts", "src/", "README.md", "LICENSE"]` (package.json is always included by npm).
Excluded by construction: `test/` (including `test/e2e/` and the mock provider), `docs/`, `.superpowers/`, `.pi/`, `.github/`, `AGENTS.md`, fixtures, and any local session artifacts.
The CI workflow gains a packaging guard step: `npm pack --dry-run --json` output is asserted against the allowlist so a future stray file fails the build instead of shipping.
Actual `npm publish` stays manual and is out of scope here.

## Activation

The workflow takes effect only once the repository is pushed to GitHub, which is a separate later decision.
Until then the same harness runs locally with `npm run test:e2e`.

## Acceptance

- `node test/e2e/run.mjs` passes locally on macOS and in the GitHub Actions ubuntu runner, unattended.
- Every scenario above runs in CI with zero network access beyond package installation.
- A deliberately broken build (e.g. revert the Esc normalization) fails the suite, proving the harness detects regressions.
- `npm pack --dry-run` contains exactly index.ts, src/, README.md, LICENSE, package.json; any extra file fails CI.
