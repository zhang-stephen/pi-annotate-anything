import { test } from "node:test";
import assert from "node:assert/strict";

import { reduceViewer } from "../../src/viewer/state.ts";
import type { ViewerState } from "../../src/viewer/state.ts";
import { COMMANDS, executeCommand, parseCommandLine, resolveAgainst } from "../../src/viewer/commands.ts";
import type { CommandSpec } from "../../src/viewer/commands.ts";

// Same fixtures as state.test.ts: 30 lines, viewport height 10, no
// horizontal follow unless a test asks for it.
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i}`);
const VH = 10;
const VP = { height: VH, contentWidth: 20, maxLineWidth: 7 };

function viewer(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    mode: "normal",
    cursor: { line: 0, col: 0 },
    anchor: null,
    scrollTop: 0,
    comment: null,
    pending: null,
    visualMode: "char",
    editingDraftId: null,
    previewOn: true,
    ...overrides,
  };
}

function view(state: ViewerState, key: string) {
  return reduceViewer(state, key, LINES, VP, []);
}

// A multi-key reducer path: each key is its own dispatch, like real typing.
function views(state: ViewerState, ...keys: string[]) {
  let res = view(state, keys[0]);
  for (const key of keys.slice(1)) res = view(res.state, key);
  return res;
}

// Parser --------------------------------------------------------------------

test("parseCommandLine: empty and whitespace-only input is none", () => {
  assert.deepEqual(parseCommandLine(""), { kind: "none" });
  assert.deepEqual(parseCommandLine("   "), { kind: "none" });
  assert.deepEqual(parseCommandLine("\t \t"), { kind: "none" });
});

test("parseCommandLine: bare digits are a 1-based address", () => {
  assert.deepEqual(parseCommandLine("5"), { kind: "address", line: 5 });
  assert.deepEqual(parseCommandLine("123"), { kind: "address", line: 123 });
});

test("parseCommandLine: otherwise whitespace splits into name and args", () => {
  assert.deepEqual(parseCommandLine("q"), { kind: "command", name: "q", args: [] });
  assert.deepEqual(parseCommandLine("noh"), { kind: "command", name: "noh", args: [] });
  assert.deepEqual(parseCommandLine("noh ls"), { kind: "command", name: "noh", args: ["ls"] });
});

test("parseCommandLine: 5q is a name (and fails resolution later, by design)", () => {
  assert.deepEqual(parseCommandLine("5q"), { kind: "command", name: "5q", args: [] });
});

// Resolver ------------------------------------------------------------------

test("resolveAgainst: exact names hit their specs", () => {
  assert.equal(resolveAgainst(COMMANDS, "quit"), COMMANDS[0]);
  assert.equal(resolveAgainst(COMMANDS, "nohlsearch"), COMMANDS[1]);
});

test("resolveAgainst: prefixes within the short bound hit", () => {
  assert.equal(resolveAgainst(COMMANDS, "q"), COMMANDS[0]);
  assert.equal(resolveAgainst(COMMANDS, "noh"), COMMANDS[1]);
  assert.equal(resolveAgainst(COMMANDS, "nohl"), COMMANDS[1]);
});

test("resolveAgainst: a name shorter than every short is not found", () => {
  // "n" and "no" stop short of nohlsearch's short form ("noh"), so neither
  // resolves (spec: shorter inputs are E492).
  assert.equal(resolveAgainst(COMMANDS, "n"), "not-found");
  assert.equal(resolveAgainst(COMMANDS, "no"), "not-found");
});

test("resolveAgainst: an unknown name is not found", () => {
  assert.equal(resolveAgainst(COMMANDS, "zzz"), "not-found");
});

test("resolveAgainst: two crafted specs sharing a short are ambiguous", () => {
  // The shipped table can never be ambiguous, so craft one that is: both
  // entries claim short "no", and "no" matches both.
  const table: CommandSpec[] = [
    { name: "noa", short: "no", args: "none", run: () => ({ state: viewer() }) },
    { name: "nob", short: "no", args: "none", run: () => ({ state: viewer() }) },
  ];
  assert.equal(resolveAgainst(table, "no"), "ambiguous");
});

// Executors -----------------------------------------------------------------

test("executeCommand: empty command line returns to normal silently", () => {
  const res = executeCommand(viewer(), "", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.message, undefined);
  assert.equal(res.effect, undefined);
  assert.deepEqual(executeCommand(viewer(), "   ", LINES, VP).state.mode, "normal");
});

test("executeCommand: quit returns to normal mode with the close effect", () => {
  const res = executeCommand(viewer(), "q", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.deepEqual(res.effect, { type: "close" });
});

test("executeCommand: nohlsearch returns to normal mode with searchHL false", () => {
  const res = executeCommand(viewer(), "noh", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.searchHL, false);
  assert.equal(res.effect, undefined);
  assert.equal(executeCommand(viewer(), "nohlsearch", LINES, VP).state.searchHL, false);
});

test("executeCommand: address jump matches the {count}G reducer path exactly", () => {
  const start = viewer({ cursor: { line: 2, col: 3 } });
  const viaCommand = executeCommand(start, "7", LINES, VP);
  const viaKeys = views(start, "7", "G");
  assert.deepEqual(viaCommand.state.cursor, viaKeys.state.cursor);
  assert.equal(viaCommand.state.scrollTop, viaKeys.state.scrollTop);
  assert.deepEqual(viaCommand.state.cursor, { line: 6, col: 3 });
  assert.equal(viaCommand.state.scrollTop, 0);
});

test("executeCommand: address jump scrolls the target in like {count}G", () => {
  const start = viewer({ cursor: { line: 25, col: 0 }, scrollTop: 16 });
  const viaCommand = executeCommand(start, "4", LINES, VP);
  const viaKeys = views(start, "4", "G");
  assert.deepEqual(viaCommand.state.cursor, viaKeys.state.cursor);
  assert.equal(viaCommand.state.scrollTop, viaKeys.state.scrollTop);
  assert.deepEqual(viaCommand.state.cursor, { line: 3, col: 0 });
  assert.equal(viaCommand.state.scrollTop, 3);
});

test("executeCommand: an out-of-range address clamps like {count}G", () => {
  const start = viewer({ cursor: { line: 2, col: 1 } });
  const viaCommand = executeCommand(start, "99", LINES, VP);
  const viaKeys = views(start, "99", "G");
  assert.deepEqual(viaCommand.state.cursor, viaKeys.state.cursor);
  assert.equal(viaCommand.state.scrollTop, viaKeys.state.scrollTop);
  assert.deepEqual(viaCommand.state.cursor, { line: 29, col: 1 });
});

// Errors --------------------------------------------------------------------

test("executeCommand: trailing arguments are rejected with E488", () => {
  const res = executeCommand(viewer(), "q extra", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.message, "E488: Trailing characters");
  assert.equal(res.effect, undefined);
});

test("executeCommand: an unknown command is rejected with E492", () => {
  const res = executeCommand(viewer(), "qq", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.message, "E492: Not an editor command: qq");
  assert.equal(res.effect, undefined);
  assert.equal(executeCommand(viewer(), "n", LINES, VP).state.message, "E492: Not an editor command: n");
});

test("executeCommand: an ambiguous abbreviation is rejected with E464", () => {
  // The shipped table can never be ambiguous, so craft a third entry that
  // collides with quit's short, then remove it again.
  const crafted: CommandSpec = { name: "quux", short: "q", args: "none", run: () => ({ state: viewer() }) };
  COMMANDS.push(crafted);
  try {
    const res = executeCommand(viewer(), "q", LINES, VP);
    assert.equal(res.state.mode, "normal");
    assert.equal(res.state.message, "E464: Ambiguous command");
    assert.equal(res.effect, undefined);
  } finally {
    COMMANDS.pop();
  }
});

test("executeCommand: the address jump ends command mode like every other path", () => {
  const state = viewer({ mode: "command", command: { value: "7" }, cursor: { line: 0, col: 3 } });
  const res = executeCommand(state, "7", LINES, VP);
  assert.equal(res.state.mode, "normal");
  assert.equal(res.state.command, null);
  assert.equal(res.state.cursor.line, 6);
});

test("parser: a single trailing bang is stripped from the command name", () => {
  assert.deepEqual(parseCommandLine("q!"), { kind: "command", name: "q", args: [] });
  assert.deepEqual(parseCommandLine("noh!"), { kind: "command", name: "noh", args: [] });
});

test("parser: a second bang stays in the name and fails resolution", () => {
  assert.deepEqual(parseCommandLine("q!!"), { kind: "command", name: "q!", args: [] });
});

test("executeCommand: :q! runs quit exactly (:q parity)", () => {
  const start = viewer({ cursor: { line: 0, col: 0 } });
  const banged = executeCommand(start, "q!", LINES, VP);
  const plain = executeCommand(start, "q", LINES, VP);
  assert.deepEqual(banged.effect, plain.effect);
  assert.deepEqual(banged.state, plain.state);
});
