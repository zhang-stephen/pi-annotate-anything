---
title: Settings Schema Evolution - Design
status: draft
---

# Settings Schema Evolution - Design

Date: 2026-10-22

## Problem

The user-settings v1 schema will change over time: keys get added, renamed, moved, or re-scoped, and users hand-edit both settings files.
Read-time behavior is already fail-open (the user-settings spec's merge rules), but renames degrade to defaults-with-warning, losing user intent, and users reasonably expect their file to migrate rather than rot.

## Approach

A deprecation table in the loader plus write-time migration through the `/annotate-config` write path, with the package major version as the only sanctioned breaking point.

## Rules

- Additive changes (new keys or groups) may ship in any release.
- Renames and moves ship with a deprecation-table entry: old key path -> new key path, marked with the release that deprecated it. Reads apply the alias before validation and warn with the rename.
- Write-time migration: every `/annotate-config` write (its read-modify-write path) normalizes the file through the table, so a hand-edited old-form file upgrades to current schema the first time the user saves any change from the overlay. No startup rewriting of user files; files untouched by the overlay keep working through aliases until removal.
- Breaking changes (alias removal, semantic reuse of a key) happen only at a major version bump. Within a major, a settings file written by any earlier minor keeps working -- the whole compatibility contract for users is one sentence.
- Semantic changes never reuse a key: changed meaning requires a new key name. Tightened ranges keep old values valid or clamp with a warning, never silently reject.
- No version field and no migration pipeline. A `$schema` pointer for editor validation is a future nice-to-have.
- The table starts empty: no released version carries settings yet, so v1 ships zero compatibility debt.

## Testing

- Unit: alias applied on read with the rename warning; write-time normalization converts deprecated forms and preserves all other keys; alias removal leaves only the warning-and-fallback path.
- `npm test` and `npx tsc --noEmit` green.

## Deferred questions

- The alias-removal checklist to run inside a major-bump release.
- Whether `/annotate-config` should surface an explicit migrate-now action (today any save migrates).
