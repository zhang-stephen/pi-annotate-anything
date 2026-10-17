// AnnotateCard: the pi-tui Component rendering the file card for the
// /annotate flow. Thin shell over the pure viewer state machine
// (viewer-state.ts): handleInput feeds reduceViewer and dispatches its
// effects (annotate/close). Rendering uses raw ANSI (inverse/underline);
// syntax colors come from pi's highlightCode with the host theme.

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { renderCommentBox } from "./comment-input.ts";
import { normalize } from "./selection.ts";
import type { Range, VisualMode } from "./selection.ts";
import { reduceViewer } from "./viewer-state.ts";
import type { ViewerState } from "./viewer-state.ts";

const DEFAULT_TAB_SIZE = 4;
const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";
const UNDERLINE_ON = "\x1b[4m";
const UNDERLINE_OFF = "\x1b[24m";

// File-area height budget: leave room for the comment box and overlay
// margins, and cap the card on tall terminals.
const MIN_VIEWPORT_ROWS = 1;
const RESERVED_ROWS = 8;
const MAX_VIEWPORT_ROWS = 30;

// Smallest multiple of tabSize strictly greater than width (tab behavior).
function nextTabStop(width: number, tabSize: number): number {
  const size = Math.max(1, tabSize);
  return width - (width % size) + size;
}

// Replaces every tab in s with spaces advancing to the next multiple of
// tabSize (default 4). Widths after a tab account for wide chars, so the
// result's visibleWidth matches rawColToDisplayCol(s, s.length).
export function tabExpanded(s: string, tabSize: number = DEFAULT_TAB_SIZE): string {
  if (!s.includes("\t")) return s;
  let out = "";
  let width = 0;
  for (const ch of s) {
    if (ch === "\t") {
      const next = nextTabStop(width, tabSize);
      out += " ".repeat(next - width);
      width = next;
    } else {
      out += ch;
      width += visibleWidth(ch);
    }
  }
  return out;
}

// Maps a raw column (UTF-16 code-unit index, the Position.col convention of
// selection.ts) to its display column after tab expansion; wide chars count
// as 2 columns. Columns outside the line clamp to the line's display width.
export function rawColToDisplayCol(line: string, col: number, tabSize: number = DEFAULT_TAB_SIZE): number {
  const bounded = Math.min(Math.max(col, 0), line.length);
  let width = 0;
  let i = 0;
  while (i < bounded) {
    const ch = String.fromCodePoint(line.codePointAt(i) as number);
    width = ch === "\t" ? nextTabStop(width, tabSize) : width + visibleWidth(ch);
    i += ch.length;
  }
  return width;
}

// Gutter width for a file with lineCount lines: right-aligned line number
// (width of the largest 1-based number), a space, the pending-marker column,
// and a space. Must stay in sync with AnnotateCard.gutter.
export function gutterWidth(lineCount: number): number {
  return String(Math.max(1, lineCount)).length + 3;
}

// Display-column spans to style within one rendered line. SGR attributes
// compose additively with independent resets (27 vs 24), so overlapping
// spans of different styles can nest safely.
type SpanStyle = "inverse" | "underline";
interface StyleSpan {
  start: number; // display column, inclusive
  end: number; // display column, exclusive
  style: SpanStyle;
}

const SPAN_CODES: Record<SpanStyle, { on: string; off: string }> = {
  inverse: { on: INVERSE_ON, off: INVERSE_OFF },
  underline: { on: UNDERLINE_ON, off: UNDERLINE_OFF },
};

// Wraps the given display-column spans of line (ANSI-aware, zero-width
// codes ignored) in their styles. Boundaries are walked cell by cell so
// overlapping spans compose and same-style overlaps collapse into one code.
function applyStyleSpans(line: string, spans: StyleSpan[]): string {
  const total = visibleWidth(line);
  const clamped = spans
    .map((s) => ({ ...s, start: Math.max(0, Math.min(s.start, total)), end: Math.min(Math.max(0, s.end), total) }))
    .filter((s) => s.end > s.start);
  if (clamped.length === 0) return line;

  const bounds = [...new Set([0, total, ...clamped.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  let out = "";
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const active = [...new Set(clamped.filter((s) => s.start <= a && a < s.end).map((s) => s.style))];
    const seg = sliceByColumn(line, a, b - a);
    if (active.length === 0) {
      out += seg;
    } else {
      out += active.map((s) => SPAN_CODES[s].on).join("") + seg + active.reverse().map((s) => SPAN_CODES[s].off).join("");
    }
  }
  return out;
}

export class AnnotateCard implements Component, Focusable {
  focused = false;
  private readonly tui: TUI;
  private readonly file: { path: string; lines: string[] }; // LF-normalized source
  // Live getter, re-read on every render: annotations created while the card
  // stays open show their "*" marker + underline immediately.
  private readonly pending: () => Range[];
  private readonly onAnnotate: (range: Range, mode: VisualMode, comment: string) => void;
  private readonly done: () => void;
  private readonly highlighted: string[];
  private state: ViewerState;

  // Fields are declared explicitly (not as parameter properties): node runs
  // TypeScript in strip-only mode, which rejects parameter property syntax.
  constructor(
    tui: TUI,
    file: { path: string; lines: string[] },
    pending: () => Range[],
    onAnnotate: (range: Range, mode: VisualMode, comment: string) => void,
    done: () => void,
  ) {
    this.tui = tui;
    this.file = file;
    this.pending = pending;
    this.onAnnotate = onAnnotate;
    this.done = done;
    // Tabs are expanded PER LINE before highlighting so display columns agree
    // between the highlighted content and the raw/selection rendering below
    // (renderLine styles against per-line tabExpanded too). Expanding the
    // whole file as one string would carry each line's width across its
    // "\n" and shift the tab stops of every later line. The cache is
    // computed once and sliced per frame (theme is stable for the card's
    // lifetime, so invalidate() is a no-op).
    this.highlighted = highlightCode(
      file.lines.map((l) => tabExpanded(l)).join("\n"),
      getLanguageFromPath(file.path),
    );
    this.state = {
      mode: "normal",
      cursor: { line: 0, col: 0 },
      anchor: null,
      scrollTop: 0,
      comment: null,
      pending: null,
      visualMode: "char",
    };
  }

  render(width: number): string[] {
    const vh = this.viewportHeight();
    const lines = this.file.lines;
    const first = Math.min(Math.max(this.state.scrollTop, 0), Math.max(0, lines.length - 1));
    const last = Math.min(lines.length, first + vh);
    const selection = this.activeSelection();
    const cursorOn = this.state.mode !== "comment";

    const out: string[] = [];
    for (let i = first; i < last; i++) {
      out.push(truncateToWidth(this.gutter(i) + this.renderLine(i, selection, cursorOn), width));
    }
    if (this.state.mode === "comment") {
      // renderCommentBox appends raw text lines and can overflow the card;
      // clip each box line to the card width, same as file lines.
      const box = renderCommentBox(this.state.comment ?? { text: "" }, width, (s) => INVERSE_ON + s + INVERSE_OFF);
      out.push(...box.map((line) => truncateToWidth(line, width)));
    }
    return out;
  }

  handleInput(data: string): void {
    const result = reduceViewer(this.state, data, this.file.lines, { height: this.viewportHeight() });
    this.state = result.state;
    if (!result.effect) return;
    if (result.effect.type === "annotate") {
      this.onAnnotate(result.effect.range, result.effect.mode, result.effect.comment);
    } else {
      this.done();
    }
    // The TUI requests an immediate render after handleInput; no explicit
    // requestRender is needed here.
  }

  invalidate(): void {}

  // Terminal rows minus headroom, clamped to the file-area budget. When the
  // comment box is open, its rendered height is subtracted from the file
  // viewport so file lines plus box always fit the overlay together. The
  // box height is width-independent (one line per text line plus borders
  // and the prompt line), so a probe width of 0 is fine here.
  private viewportHeight(): number {
    let available = this.tui.terminal.rows - RESERVED_ROWS;
    if (this.state.mode === "comment") {
      available -= renderCommentBox(this.state.comment ?? { text: "" }, 0, (s) => s).length;
    }
    return Math.max(MIN_VIEWPORT_ROWS, Math.min(available, MAX_VIEWPORT_ROWS));
  }

  // The anchor/cursor pair reduced to a forward range, or null when no
  // selection is active. Kept visible in comment mode so the user still
  // sees what they are annotating.
  private activeSelection(): Range | null {
    if (this.state.anchor === null) return null;
    return normalize(
      { anchor: this.state.anchor, cursor: this.state.cursor, mode: this.state.visualMode },
      this.file.lines,
    );
  }

  // "N * " style gutter; line numbers are 1-based (see message.ts).
  private gutter(line: number): string {
    const digits = String(Math.max(1, this.file.lines.length)).length;
    const marked = this.pending().some((r) => r.startLine <= line && line <= r.endLine);
    return String(line + 1).padStart(digits) + " " + (marked ? "*" : " ") + " ";
  }

  // One file line: highlighted content unless the selection covers the line
  // (selection display wins), then pending underlines, then the cursor cell.
  private renderLine(line: number, selection: Range | null, cursorOn: boolean): string {
    const raw = this.file.lines[line] ?? "";
    const spans: StyleSpan[] = [];

    let base: string;
    if (selection !== null && line >= selection.startLine && line <= selection.endLine) {
      base = tabExpanded(raw); // raw, tab-expanded, unhighlighted
      const span = this.displaySpan(raw, line, selection);
      if (span !== null) spans.push({ start: span[0], end: span[1], style: "inverse" });
    } else {
      base = this.highlighted[line] ?? "";
    }

    for (const p of this.pending()) {
      if (line < p.startLine || line > p.endLine) continue;
      const span = this.displaySpan(raw, line, p);
      if (span !== null) spans.push({ start: span[0], end: span[1], style: "underline" });
    }

    let virtualCursorCell = false;
    if (cursorOn && this.state.cursor.line === line) {
      const dcol = rawColToDisplayCol(raw, this.state.cursor.col);
      if (dcol < visibleWidth(base)) {
        spans.push({ start: dcol, end: dcol + 1, style: "inverse" });
      } else {
        virtualCursorCell = true; // one-past-the-end cursor: rendered below
      }
    }

    const content = applyStyleSpans(base, spans);
    return virtualCursorCell ? content + INVERSE_ON + " " + INVERSE_OFF : content;
  }

  // The [start, end) display-column span a range covers on the given line,
  // or null when it covers nothing. Works for the selection and pending
  // ranges alike: boundary lines use the range's columns, inner lines are
  // covered to the end of the raw line.
  private displaySpan(raw: string, line: number, range: Range): [number, number] | null {
    const startCol = line === range.startLine ? range.startCol : 0;
    const endCol = line === range.endLine ? range.endCol : raw.length;
    const start = rawColToDisplayCol(raw, startCol);
    const end = rawColToDisplayCol(raw, endCol);
    return end > start ? [start, end] : null;
  }
}
