---
title: User Settings - Design
status: approved
---

# User Settings - Design

Date: 2026-10-22

## Problem

Behavior constants that users may legitimately want to tune are hardcoded: the file admission threshold, tab width, viewport height cap, completion drawer height, and Nerd Font glyphs.
pi (through 1.3.0) has no extension-namespaced settings: settings.json covers built-in behavior only and no registerSettings-style API exists, so every tuning request today means a code change.

## Approach

The extension manages its own settings files following pi's own conventions: a global `getAgentDir()/pi-annotate-anything.json` and a project `<cwd>/.pi/pi-annotate-anything.json`, deep-merged with project-overrides-global.
A zero-dependency loader in `src/core/settings.ts` validates, clamps, and fail-opens to defaults; consumers receive the resolved settings object instead of importing scattered constants.
An `/annotate-config` command opens a settings overlay built on pi-tui's exported `SettingsList` component, showing effective values, provenance, and validation issues, writing edits back, and reloading on demand.

## Files and merge

- Global file: `getAgentDir()` from the pi SDK, plus `pi-annotate-anything.json`.
- Project file: `<session cwd>/.pi/pi-annotate-anything.json`.
- Deep merge: nested plain objects merge recursively; scalars and arrays are replaced whole; project wins over global, global wins over defaults.
- Unknown keys produce a warning and are dropped (typo protection, forward compatibility).
- A value with the wrong type or out of range is warned about and falls back per key: project value invalid -> global value if valid -> default.
- An unparseable file is warned about and ignored whole; a missing file is normal.
- Fail-open always: no settings-file state may break or crash the session.

## Schema (v1)

```json
{
  "file": {
    "maxBytes": 1048576
  },
  "viewer": {
    "tabSize": 4,
    "maxRows": 30,
    "completions": { "maxRows": 5 },
    "icons": {
      "mode": "auto",
      "alt": { "nerdfont": "\uF075", "ascii": "*" }
    }
  }
}
```

- `file.maxBytes`: files larger than this are refused before the card opens (today `DEFAULT_MAX_BYTES` in `src/core/file-range.ts`). Range 1024 to 1073741824 (1 KiB to 1 GiB).
- `viewer.maxRows`: viewport height cap (today `MAX_VIEWPORT_ROWS` in `src/viewer/layout.ts`); the runtime clamp to terminal height stays. Range 5 to 200.
- `viewer.tabSize`: display tab width (today `DEFAULT_TAB_SIZE` in `src/tui/display.ts`). Range 1 to 16.
- `viewer.completions.maxRows`: completion drawer height (today `MAX_COMPLETION_ROWS` in `src/viewer/completion-panel.ts`). Range 1 to 20.
- `viewer.icons`: glyph set and fallback glyphs, see the icons section.

The overlay is the codebase's "viewer" (`src/viewer/`), so the group is named `viewer`; everything reachable inside the overlay lives under `viewer.*`, while `file.*` gates pre-card admission.
Internal layout invariants (PAD_X, CHROME_ROWS, editor box width, marker widths, NON_INDEXABLE_DIRS) deliberately stay out of v1: exposing them invites broken layouts; keys get promoted individually on real demand.

## Schema evolution

No released version carries settings yet, so v1 ships with zero compatibility debt.
Evolution mechanics (deprecation table, write-time migration via /annotate-config, major-version breaking points) are designed separately in `specs/2026-10-22-settings-evolution-design.md`; until that lands, the only binding rule here is the merge rules' fail-open behavior.

## icons

`icons.mode`: `"auto"` (default) | `"nerdfont"` | `"ascii"`; `icons.alt` customizes the glyph each mode renders.

- `nerdfont`: the pending marker renders `alt.nerdfont` (default: the built-in nf-fa-comment, U+F075).
- `ascii`: the marker renders `alt.ascii` (default `*`).
- `auto`: conservative detection -- TERM=linux or TERM=dumb resolves to `ascii`, anything else to `nerdfont`; the env var `PI_ANNOTATE_ICONS` (`nerdfont` | `ascii`) overrides both files for one-off use.
- `alt` values must be a single non-control character; anything longer is warned about and falls back to the default. Any glyph fits any slot (an NF codepoint in `alt.ascii` works), so "icons off" needs no mode of its own -- point the slots at whatever you want to see.
- Ambiguous-width glyphs render two cells wide on some CJK-configured terminals; users pick narrow glyphs via `alt`.
- Box-drawing and other universal glyphs (CONTINUATION_MARK U+2502) are structural, not icons, and stay in all modes.
- NF-leaning default rationale: pi's own TUI already renders NF icons, so a terminal running pi almost certainly renders NF; `ascii` is the explicit escape hatch.
- v1 has a single icon slot (the pending marker), so `alt` is two flat keys; when more slots appear, `alt` grows per-slot objects. Renderers consult one resolved glyph table either way -- a future icon is a mapping row, never a new setting key.

## Removed behavior: q/Esc quick close

The quick-close path is deleted outright rather than made a setting.

- Today: `q` in normal mode closes the card, and Esc closes it when not in visual mode (`src/viewer/state.ts`).
- After: both are permanent no-ops in normal mode; visual-mode Esc (drop anchor) and comment-mode Esc (cancel) are unchanged; `:q` is the only close path.
- Rationale: Esc is overloaded three ways and reflexively pressed; one extra press in normal mode discards viewer state (open file, scroll position, selection). Drafts survive in the in-memory store and `/annotate` reopens the card, but the state loss is real. A setting would keep the footgun one edit away for no real gain -- single-key close saves three keystrokes over `:q` plus Enter.
- The viewer handles no ctrl+c, so the footer must keep `:q` discoverable: the normal-mode hint becomes the static `:q close`; hints never render conditionally on settings.

## Loading and wiring

- `src/core/settings.ts`: a `Settings` type, `DEFAULTS` as the single source of truth (the four constants listed above fold in here), and pure `mergeSettings` / `validate` functions returning `{ settings, issues }`; no imports from `tui/` or `viewer/`.
- Load once at `session_start`; a card reads the resolved object passed in at construction (no module-level mutable singleton; whether pure display helpers take it as an argument or via a one-time configure is a plan-level call-site decision).
- `/annotate-config`: opens an overlay built on pi-tui's exported `SettingsList` component (`SettingItem[]`: label, description, currentValue; `values` cycling or a `submenu` Component), themed via the SDK's `getSettingsListTheme()`.
- The overlay's first item picks the write scope (project file | global file); the list itself shows the effective merged values, with each item's description noting which file the value comes from.
- Enum settings cycle through `values`; numeric settings open a one-line input submenu and validate on commit -- out-of-range or malformed input keeps the old value and shows an issue line.
- Edits persist immediately to the chosen scope's file (read that file, set the key, write back, preserving its other keys) and apply to cards opened afterwards; a live card keeps its construction-time settings.
- `/annotate-config reload` re-reads both files for hand edits outside the overlay.

## Testing

- Unit: deep merge and precedence; unknown key, wrong type, out-of-range value, invalid JSON, and the per-key fallback chain; icons resolution (auto downgrade paths, env override, alt validation); the state reducer after quick-close removal (q and Esc are no-ops in normal mode, unchanged in visual and comment modes).
- `npm test` (includes the docs front-matter / STATUS sync check) and `npx tsc --noEmit` green.
- Manual E2E in a real terminal with the minimal sandbox (`PI_CODING_AGENT_DIR=/tmp/pi-sandbox-home pi -e ./index.ts`): the global file is `/tmp/pi-sandbox-home/pi-annotate-anything.json`, and the project file is `<fixture>/.pi/pi-annotate-anything.json` inside a /tmp fixture tree (fixtures live outside the repo per repo policy).
- E2E checks: global+project precedence, `/annotate-config` output and reload, TERM=launch-env icons fallback (run once with TERM=linux), `PI_ANNOTATE_ICONS` override, closing via `:q`, and that q/Esc no longer close.

## Documentation

- README gains a Settings section: file locations, precedence, the v1 schema with defaults, and a worked example.

## Rejected alternatives

- Injecting keys into pi's own settings.json or its /settings screen: the exported `SettingsConfig` schema is pi-internal and foreign keys would hijack pi's namespace and risk pi-side validation noise. The settings UI itself, though, is reusable -- pi-tui's `SettingsList` component is exactly what `/annotate-config` builds on.
- A `quickExit` setting instead of deletion: keeps a footgun one edit away for three saved keystrokes; deleted (see the removed-behavior section).
