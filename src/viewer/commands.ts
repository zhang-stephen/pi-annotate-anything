// Command-line (:) front end of the viewer: parsing of the typed line,
// abbreviation resolution against the command table, and execution against
// the reducer's state shape. Pure like the rest of src/viewer: no I/O, no pi
// imports. state.ts imports executeCommand back, so this module only takes
// types from state.ts (erased at runtime) and runtime helpers from
// movement.ts - no runtime cycle.

import type { ViewerResult, ViewerState, ViewerViewport } from "./state.ts";
import { consumeCount, moved } from "./movement.ts";

export type Parsed =
  | { kind: "none" }
  | { kind: "address"; line: number }
  | { kind: "command"; name: string; args: string[] };

// "5" jumps to line 5; anything else non-empty is a command line whose first
// word is the name (so ":5q" parses as the name "5q" and fails resolution,
// per spec) and whose remaining words are its arguments.
export function parseCommandLine(raw: string): Parsed {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "none" };
  if (/^\d+$/.test(trimmed)) return { kind: "address", line: Number(trimmed) };
  let [name, ...args] = trimmed.split(/\s+/);
  // A single trailing bang is stripped and silently ignored (:q! == :q);
  // a second bang stays in the name and fails resolution as E492.
  if (name.length > 1 && name.endsWith("!")) name = name.slice(0, -1);
  return { kind: "command", name, args };
}

export interface CommandSpec {
  name: string;
  // Minimum unambiguous prefix a typed name must reach; resolution requires
  // the typed name to start with it (and the name to start with the typed
  // prefix), so "n" resolves to nothing while "noh" resolves to nohlsearch.
  short: string;
  // One-line description shown in the completion panel's candidate rows.
  desc: string;
  args: "none";
  run(state: ViewerState, lines: string[], viewport: ViewerViewport): ViewerResult;
}

// A spec matches a typed name iff the name is a prefix of the full name and
// reaches at least the short form; exactly one match wins, zero is
// not-found, two or more is ambiguous (vim's E464).
export function resolveAgainst(table: CommandSpec[], name: string): CommandSpec | "not-found" | "ambiguous" {
  const hits = table.filter((spec) => spec.name.startsWith(name) && name.startsWith(spec.short));
  if (hits.length === 0) return "not-found";
  if (hits.length > 1) return "ambiguous";
  return hits[0];
}

export const COMMANDS: CommandSpec[] = [
  {
    name: "quit",
    short: "q",
    desc: "close the card",
    args: "none",
    run: (state) => ({ state: { ...state, mode: "normal" }, effect: { type: "close" } }),
  },
  {
    name: "nohlsearch",
    short: "noh",
    desc: "clear search highlight",
    args: "none",
    run: (state) => ({ state: { ...state, mode: "normal", searchHL: false } }),
  },
];

// Live candidates for the completion panel's command-name source: the table
// entries whose full name starts with the typed word, in table order. Empty
// input (bare ":") hides the panel, and whitespace-bearing input hides it
// too - the name is done there and arguments begin, but no v1 command has a
// completion source for them.
export function completeFor(input: string): { name: string; desc: string }[] {
  if (input === "" || /\s/.test(input)) return [];
  return COMMANDS.filter((spec) => spec.name.startsWith(input)).map((spec) => ({ name: spec.name, desc: spec.desc }));
}

export function executeCommand(state: ViewerState, raw: string, lines: string[], viewport: ViewerViewport): ViewerResult {
  // Total normalization: every execution ends command mode with the draft
  // cleared, regardless of what the caller passed in. The reducer already
  // clears the draft on Enter; owning the normalization here too makes the
  // function safe for any future caller.
  const out = executeParsed(state, raw, lines, viewport);
  return { ...out, state: { ...out.state, mode: "normal", command: null } };
}

function executeParsed(state: ViewerState, raw: string, lines: string[], viewport: ViewerViewport): ViewerResult {
  const parsed = parseCommandLine(raw);
  // Empty Enter: back to normal mode, no message, no effect.
  if (parsed.kind === "none") return { state: { ...state, mode: "normal" } };
  if (parsed.kind === "address") {
    // {count}G parity: identical line math and moved() plumbing as the G arm
    // of the reducer (column preserved, line clamped into the file, viewport
    // follows), so ":7" and "7G" land on the same state.
    // Every execution path ends command mode, the address jump included:
    // mode stays "command" in the incoming state and must flip here, or the
    // next ":" keypress is swallowed as input content (E2E regression).
    const line = Math.min(Math.max(parsed.line - 1, 0), lines.length - 1);
    return consumeCount(moved({ ...state, wantedCol: null }, { line, col: state.cursor.col }, lines, viewport));
  }
  const resolved = resolveAgainst(COMMANDS, parsed.name);
  if (resolved === "not-found") {
    return { state: { ...state, mode: "normal", message: `E492: Not an editor command: ${parsed.name}` } };
  }
  if (resolved === "ambiguous") {
    return { state: { ...state, mode: "normal", message: "E464: Ambiguous command" } };
  }
  if (parsed.args.length > 0) {
    return { state: { ...state, mode: "normal", message: "E488: Trailing characters" } };
  }
  return resolved.run(state, lines, viewport);
}
