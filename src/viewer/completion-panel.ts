// Pure rendering of the command-name completion panel: the candidate list
// derived from the viewer state (the live candidates of the typed value
// while editing, the frozen anchor list with a selection while Tab cycles)
// and the styled panel rows painted over the bottom-most body rows. Like
// status-line.ts, all colors are injected as (text) => string functions;
// the only host imports are the width helpers the chrome already uses.

import { visibleWidth } from "@earendil-works/pi-tui";

import type { ChromeColors } from "../tui/card-chrome.ts";
import { completeFor } from "./commands.ts";
import type { ViewerState } from "./state.ts";

// Raw SGR for the selected row, mirroring the cmdline cursor cell (defined
// locally so this module's host imports stay width-only).
const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

// Panel cap: at most five candidate rows render above the footer.
export const MAX_COMPLETION_ROWS = 5;

// The drawer label names what is being completed; today the single source
// ships the constant, and future sources (paths for :e, buffers for :b)
// carry their own.
const COMPLETION_LABEL = "completions";

export interface CompletionPanel {
  // The drawer label painted on the divider ("completions"; a future
  // source names itself, e.g. "paths").
  label: string;
  // Candidate rows in source order, capped at MAX_COMPLETION_ROWS.
  rows: { name: string; desc: string }[];
  // Index into rows of the Tab-cycling selection, or null in live mode: the
  // panel is a suggestion list, never a second input, so nothing is
  // selected while the value is still being typed.
  selected: number | null;
}

// The panel for one render: while the command draft is Tab-cycling (a
// completion anchor is set) the list is the frozen anchor's candidates with
// the selection; otherwise it is the live candidates of the typed value with
// none. No command draft (not in command mode) and an empty candidate list
// (bare ":", no match) both mean no panel.
export function completionCandidates(state: ViewerState): CompletionPanel {
  const command = state.command ?? null;
  if (command === null) return { rows: [], selected: null, label: COMPLETION_LABEL };
  const completion = command.completion ?? null;
  const rows = (completion !== null ? completeFor(completion.anchor) : completeFor(command.value))
    .slice(0, MAX_COMPLETION_ROWS);
  // The reducer keeps the index inside the source list (it wraps modulo the
  // anchor's candidate count); remap it into the capped window so the
  // selection stays visible, and degrade to no selection for a hand-built
  // state whose anchor has no candidates.
  const selected = completion === null || rows.length === 0 ? null : completion.index % rows.length;
  return { rows, selected, label: COMPLETION_LABEL };
}

// The labeled divider that opens the drawer: a dim rule broken by the
// accent label and, only while Tab-cycling, the dim position count at the
// right end ("2/4" of the capped window). Narrow widths drop the count
// first, then degrade to a plain rule, so the drawer always opens with a
// visible separator row exactly as wide as the content.
export function renderCompletionDivider(panel: CompletionPanel, innerWidth: number, colors: ChromeColors): string {
  const rule = (n: number) => colors.border("─".repeat(Math.max(0, n)));
  if (innerWidth < 2) return rule(innerWidth);
  const label = colors.accent(" " + panel.label + " ");
  let count = panel.selected === null || panel.rows.length === 0 ? "" : colors.dim(` ${panel.selected + 1}/${panel.rows.length} `);
  let fill = innerWidth - 1 - visibleWidth(label) - visibleWidth(count);
  if (fill < 0 && count !== "") {
    count = "";
    fill = innerWidth - 1 - visibleWidth(label);
  }
  if (fill < 0) return rule(innerWidth);
  return rule(1) + label + rule(fill) + count;
}

// First n display columns of s, dropping whole characters at the cut edge.
// The table's names and descriptions are plain text, so unlike pi-tui's
// truncateToWidth no ellipsis and no ANSI reset are appended (a reset would
// otherwise ride mid-row inside the styled content).
function headByWidth(s: string, n: number): string {
  if (n <= 0) return "";
  const chars = [...s];
  let width = 0;
  let end = 0;
  for (let i = 0; i < chars.length; i++) {
    const cw = visibleWidth(chars[i]);
    if (width + cw > n) break;
    width += cw;
    end = i + 1;
  }
  return chars.slice(0, end).join("");
}

// One styled row per candidate: the name, two spaces, and the dim one-line
// description. The selected row renders inverted like the cmdline cursor
// cell, with the description unstyled so the inversion owns the emphasis.
// The description truncates first (whole characters at the cut edge), and a
// row that cannot fit it drops the separator spaces too, so every row stays
// within the width; rows are space-padded to exactly the width so the shell
// can replace body rows wholesale without breaking the frame.
export function renderCompletionRows(panel: CompletionPanel, innerWidth: number, colors: ChromeColors): string[] {
  return panel.rows.map((row, i) => {
    const name = headByWidth(row.name, innerWidth);
    const descBudget = innerWidth - visibleWidth(name) - 2;
    const desc = descBudget > 0 ? headByWidth(row.desc, descBudget) : "";
    const sep = desc !== "" ? "  " : "";
    const content = i === panel.selected
      ? INVERSE_ON + name + sep + desc + INVERSE_OFF
      : name + sep + (desc !== "" ? colors.dim(desc) : "");
    return content + " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
  });
}
