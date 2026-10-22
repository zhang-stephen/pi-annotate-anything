import { test } from "node:test";
import assert from "node:assert/strict";

import { COMMANDS } from "../../src/viewer/commands.ts";
import type { CommandSpec } from "../../src/viewer/commands.ts";
import { completionCandidates, MAX_COMPLETION_ROWS, renderCompletionClosing, renderCompletionDivider, renderCompletionRows } from "../../src/viewer/completion-panel.ts";
import type { ViewerState } from "../../src/viewer/state.ts";

// Command-mode state carrying just the draft under test: the panel derives
// everything from state.command.
function commandState(command: ViewerState["command"]): ViewerState {
  return {
    mode: "command",
    cursor: { line: 0, col: 0 },
    anchor: null,
    scrollTop: 0,
    comment: null,
    pending: null,
    visualMode: "char",
    editingDraftId: null,
    previewOn: true,
    command,
  };
}

// A crafted extra command so multi-row panels exist (the shipped table's
// two names share no prefix); pushed per test, popped in finally, mirroring
// the ambiguity fixture in commands.test.ts.
function crafted(name: string): CommandSpec {
  return { name, short: name, desc: "extra", args: "none", run: (state) => ({ state }) };
}

// Colors as markers, so each test pins exactly which spans a row styles
// (dim descriptions, inverse selection) and the plain padding stays plain.
const colors = {
  bg: (s: string) => `bg(${s})`,
  border: (s: string) => `border(${s})`,
  dim: (s: string) => `dim(${s})`,
  accent: (s: string) => `accent(${s})`,
  warning: (s: string) => `warning(${s})`,
};

const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

// completionCandidates --------------------------------------------------------

test("completionCandidates: no draft, empty input, and no match mean no panel", () => {
  assert.deepEqual(completionCandidates(commandState(null)), { rows: [], selected: null, label: "completions" });
  assert.deepEqual(completionCandidates(commandState({ value: "" })), { rows: [], selected: null, label: "completions" });
  assert.deepEqual(completionCandidates(commandState({ value: "zzz" })), { rows: [], selected: null, label: "completions" });
});

test("completionCandidates: live mode lists the value's candidates with no selection", () => {
  assert.deepEqual(completionCandidates(commandState({ value: "n" })), {
    rows: [{ name: "nohlsearch", desc: "clear search highlight" }],
    selected: null,
    label: "completions",
  });
});

test("completionCandidates: cycling shows the frozen anchor list with the selection", () => {
  COMMANDS.push(crafted("nohextra"));
  try {
    assert.deepEqual(
      completionCandidates(commandState({ value: "nohextra", completion: { anchor: "n", index: 1 } })),
      {
        rows: [
          { name: "nohlsearch", desc: "clear search highlight" },
          { name: "nohextra", desc: "extra" },
        ],
        selected: 1,
        label: "completions",
      },
    );
  } finally {
    COMMANDS.pop();
  }
});

// renderCompletionRows --------------------------------------------------------

test("render: rows show name, two spaces, and the dim description; live mode has no selection", () => {
  const rows = renderCompletionRows(completionCandidates(commandState({ value: "n" })), 60, colors);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].startsWith("nohlsearch  dim(clear search highlight)"), `row content, got: ${rows[0]}`);
  assert.ok(!rows[0].includes(INVERSE_ON), "live mode selects nothing");
  // Padded to the full width so painting can replace body rows wholesale
  // without breaking the frame's uniform width.
  assert.equal(rows[0].length, 60);
});

test("render: the selected row renders inverted with the description unstyled", () => {
  const panel = completionCandidates(commandState({ value: "nohlsearch", completion: { anchor: "n", index: 0 } }));
  const rows = renderCompletionRows(panel, 60, colors);
  assert.ok(
    rows[0].startsWith(INVERSE_ON + "nohlsearch  clear search highlight" + INVERSE_OFF),
    `selected row, got: ${JSON.stringify(rows[0])}`,
  );
});

test("render: only the selected row inverts; the others keep the dim description", () => {
  COMMANDS.push(crafted("nohextra"));
  try {
    const panel = completionCandidates(commandState({ value: "nohextra", completion: { anchor: "n", index: 1 } }));
    const rows = renderCompletionRows(panel, 60, colors);
    assert.ok(
      !rows[0].includes(INVERSE_ON) && rows[0].startsWith("nohlsearch  dim(clear search highlight)"),
      `non-selected row, got: ${rows[0]}`,
    );
    assert.ok(rows[1].startsWith(INVERSE_ON + "nohextra"), `selected row, got: ${rows[1]}`);
  } finally {
    COMMANDS.pop();
  }
});

test("render: the panel caps at five rows in table order", () => {
  const extra = ["1", "2", "3", "4", "5"].map((n) => crafted(`nohx${n}`));
  for (const c of extra) COMMANDS.push(c);
  try {
    const panel = completionCandidates(commandState({ value: "n" }));
    assert.equal(panel.rows.length, MAX_COMPLETION_ROWS);
    assert.equal(panel.rows[0].name, "nohlsearch");
    assert.equal(renderCompletionRows(panel, 60, colors).length, MAX_COMPLETION_ROWS);
  } finally {
    for (let i = 0; i < extra.length; i++) COMMANDS.pop();
  }
});

test("render: narrow rows truncate the description first, then drop it and the separator", () => {
  const panel = completionCandidates(commandState({ value: "n" }));
  // The name (10 columns) plus the two-space separator leaves 2 columns.
  assert.equal(renderCompletionRows(panel, 14, colors)[0], "nohlsearch  dim(cl)");
  // The name alone fills the row: the separator drops with the description,
  // so the row never exceeds the width.
  assert.equal(renderCompletionRows(panel, 10, colors)[0], "nohlsearch");
});

// renderCompletionDivider -----------------------------------------------------

test("divider: dim rule broken by the dim label with the cycling count", () => {
  // The drawer only exists while Tab-cycling, so a painted divider always
  // carries the position count beside the label (accent stays reserved for
  // the mode badge).
  const panel = completionCandidates(commandState({ value: "nohlsearch", completion: { anchor: "n", index: 0 } }));
  const d = renderCompletionDivider(panel, 40, colors);
  // Marker colors are visible-width text: "dim( completions )" is 18
  // columns and "dim(1/1 )" 9 here, so the fill is 40 - 1 - 18 - 9
  // (production ANSI is zero-width; composition order is what this pins).
  assert.equal(d, "border(─)" + "dim( completions )" + "dim(1/1 )" + "border(" + "─".repeat(12) + ")");
});

test("divider: cycling paints the dim count beside the label", () => {
  COMMANDS.push(crafted("nohextra"));
  try {
    const panel = completionCandidates(commandState({ value: "nohextra", completion: { anchor: "n", index: 1 } }));
    const d = renderCompletionDivider(panel, 40, colors);
    assert.equal(d, "border(─)" + "dim( completions )" + "dim(2/2 )" + "border(" + "─".repeat(12) + ")");
  } finally {
    COMMANDS.pop();
  }
});

test("divider: narrow widths drop the count first, then degrade to a plain rule", () => {
  const panel = completionCandidates(commandState({ value: "nohextra", completion: { anchor: "n", index: 1 } }));
  COMMANDS.push(crafted("nohextra"));
  try {
    // Marker widths: lead + label = 19, count = 9. At 27 the count
    // drops (fill 8); at 19 the label fits with zero fill; at 18 the label
    // cannot fit and the divider degrades to a plain rule.
    assert.equal(renderCompletionDivider(panel, 27, colors), "border(─)" + "dim( completions )" + "border(" + "─".repeat(8) + ")");
    assert.equal(renderCompletionDivider(panel, 19, colors), "border(─)" + "dim( completions )");
    assert.equal(renderCompletionDivider(panel, 18, colors), "border(" + "─".repeat(18) + ")");
  } finally {
    COMMANDS.pop();
  }
});

// renderCompletionClosing ------------------------------------------------------

test("closing: a plain rule exactly as wide as the content", () => {
  assert.equal(renderCompletionClosing(40, colors), "border(" + "─".repeat(40) + ")");
  assert.equal(renderCompletionClosing(1, colors), "border(─)");
});

test("closing: below one column the rule is the empty string", () => {
  assert.equal(renderCompletionClosing(0, colors), "border()");
  assert.equal(renderCompletionClosing(-3, colors), "border()");
});
