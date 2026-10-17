// AnnotateCard: the pi-tui Component rendering the file card for the
// /annotate flow. Thin shell over the pure viewer state machine
// (viewer-state.ts): handleInput feeds reduceViewer and dispatches its
// effects (annotate/update/delete/close). Rendering frames the file as a
// bordered panel via the card-chrome helpers (framePanel, frameCommentBox,
// commentBoxPlacement, FOOTER_HINTS); all chrome colors come from the pi
// theme passed by the ctx.ui.custom factory, and syntax colors come from
// pi's highlightCode with the same theme.

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { matchesKey, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { FOOTER_HINTS, commentBoxPlacement, frameCommentBox, framePanel } from "./card-chrome.ts";
import type { CardMode, ChromeColors } from "./card-chrome.ts";
import { displayPath } from "./message.ts";
import { normalize } from "./selection.ts";
import type { Range, VisualMode } from "./selection.ts";
import { reduceViewer } from "./viewer-state.ts";
import type { PendingDraft, ViewerMode, ViewerState } from "./viewer-state.ts";

const DEFAULT_TAB_SIZE = 4;
const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

// File-area height budget: the panel chrome fixes 3 rows (top + bottom
// border, footer), and the card is capped on tall terminals. The floating
// comment box occludes content rows and does not consume this budget.
const MIN_VIEWPORT_ROWS = 1;
const CHROME_ROWS = 3;
const MAX_VIEWPORT_ROWS = 30;

// The comment box title (read-only previews in Task 4 reuse the same title).
const COMMENT_BOX_TITLE = "Comment";

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

// Display-column spans to style within one rendered line. Styling functions
// wrap text segments (SGR attributes are additive with independent resets),
// so overlapping spans of different styles can nest safely.
type SpanStyle = "inverse" | "underline";
interface StyleSpan {
  start: number; // display column, inclusive
  end: number; // display column, exclusive
  style: SpanStyle;
}

// Wraps the given display-column spans of line (ANSI-aware, zero-width
// codes ignored) in their styles. Boundaries are walked cell by cell so
// overlapping spans compose and same-style overlaps collapse into one wrap.
function applyStyleSpans(line: string, spans: StyleSpan[], styles: Record<SpanStyle, (s: string) => string>): string {
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
    out += active.reduce((text, s) => styles[s](text), seg);
  }
  return out;
}

// Maps ViewerMode (kebab) to the FOOTER_HINTS key (camel).
function cardModeOf(mode: ViewerMode): CardMode {
  if (mode === "visual-char") return "visualChar";
  if (mode === "visual-line") return "visualLine";
  return mode;
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
  // Edit/delete seams (all optional so pre-chrome callers keep working):
  // the reducer emits "update"/"delete" for normal-mode c/x on pending
  // drafts, and pendingDrafts is the live drafts list (token/range/comment,
  // oldest first) the reducer targets with. Task 2's chrome rework must
  // keep these seams; see .superpowers/sdd task-3 report.
  private readonly onUpdateComment: (draftId: string, comment: string) => void;
  private readonly onDeleteDraft: (draftId: string) => void;
  private readonly pendingDrafts: () => PendingDraft[];
  private readonly cwd: string;
  private readonly colors: ChromeColors;
  private readonly spanStyles: Record<SpanStyle, (s: string) => string>;
  private readonly highlighted: string[];
  private state: ViewerState;

  // Fields are declared explicitly (not as parameter properties): node runs
  // TypeScript in strip-only mode, which rejects parameter property syntax.
  // theme is the active pi Theme from the ctx.ui.custom factory (index.ts);
  // cwd renders the title's relative path. The theme is stable for the
  // card's lifetime, so the color records are built once here.
  constructor(
    tui: TUI,
    file: { path: string; lines: string[] },
    pending: () => Range[],
    onAnnotate: (range: Range, mode: VisualMode, comment: string) => void,
    done: () => void,
    onUpdateComment: (draftId: string, comment: string) => void = () => {},
    onDeleteDraft: (draftId: string) => void = () => {},
    pendingDrafts: () => PendingDraft[] = () => [],
    theme: Theme,
    cwd: string,
  ) {
    this.tui = tui;
    this.file = file;
    this.pending = pending;
    this.onAnnotate = onAnnotate;
    this.done = done;
    this.onUpdateComment = onUpdateComment;
    this.onDeleteDraft = onDeleteDraft;
    this.pendingDrafts = pendingDrafts;
    this.cwd = cwd;
    this.colors = {
      bg: (s) => theme.bg("customMessageBg", s),
      border: (s) => theme.fg("border", s),
      dim: (s) => theme.fg("dim", s),
      accent: (s) => theme.fg("accent", s),
      warning: (s) => theme.fg("warning", s),
    };
    // Inverse stays raw ANSI (theme-neutral cursor/selection highlight);
    // pending underlines take the theme warning color.
    this.spanStyles = {
      inverse: (s) => INVERSE_ON + s + INVERSE_OFF,
      underline: (s) => this.colors.warning(s),
    };
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
      editingDraftId: null,
    };
  }

  render(width: number): string[] {
    const inner = width - 2; // one border column on each side
    const vh = this.viewportHeight();
    const lines = this.file.lines;
    const first = Math.min(Math.max(this.state.scrollTop, 0), Math.max(0, lines.length - 1));
    const last = Math.min(lines.length, first + vh);
    const selection = this.activeSelection();
    const cursorOn = this.state.mode !== "comment";

    // Content rows are clipped to the inner width, then space-padded to it so
    // the floating comment box can replace exact display-column slices below.
    const rows: string[] = [];
    for (let i = first; i < last; i++) {
      rows.push(truncateToWidth(this.gutter(i) + this.renderLine(i, selection, cursorOn), inner, "...", true));
    }
    if (this.state.mode === "comment") this.overlayCommentBox(rows, first, inner);

    const count = this.pending().length;
    const title = "Annotate: " + displayPath(this.file.path, this.cwd) + (count > 0 ? ` (${count})` : "");
    const hints = FOOTER_HINTS[cardModeOf(this.state.mode)];
    // Hints are fixed strings that can exceed narrow panels; truncate the
    // hints portion by display width (innerRow pads but never truncates).
    const footer = hints.badge
      ? this.colors.accent(hints.badge) + "  " + this.colors.dim(truncateToWidth(hints.hints, Math.max(0, inner - visibleWidth(hints.badge) - 2), ""))
      : this.colors.dim(truncateToWidth(hints.hints, inner, ""));
    return framePanel(rows, width, { title, footer, colors: this.colors });
  }

  handleInput(data: string): void {
    // Terminals in kitty keyboard mode deliver the Escape key as a CSI-u
    // sequence (e.g. "\x1b[27u") instead of a bare "\x1b". Normalize every
    // escape flavor to the legacy form the reducer understands.
    const key = matchesKey(data, "escape") ? "\x1b" : data;
    const result = reduceViewer(this.state, key, this.file.lines, { height: this.viewportHeight() }, this.pendingDrafts());
    this.state = result.state;
    if (!result.effect) return;
    if (result.effect.type === "annotate") {
      this.onAnnotate(result.effect.range, result.effect.mode, result.effect.comment);
    } else if (result.effect.type === "update") {
      this.onUpdateComment(result.effect.draftId, result.effect.comment);
    } else if (result.effect.type === "delete") {
      this.onDeleteDraft(result.effect.draftId);
    } else {
      this.done();
    }
    // The TUI requests an immediate render after handleInput; no explicit
    // requestRender is needed here.
  }

  invalidate(): void {}

  // Terminal rows minus the panel chrome (2 border + 1 footer), clamped to
  // the file-area budget. The floating comment box occludes content rows and
  // does NOT consume viewport budget, so this is comment-mode independent.
  private viewportHeight(): number {
    // pi-tui clips overlays to floor(0.8 * terminal rows) when maxHeight is
    // "80%", so budget against the overlay height rather than the full
    // terminal height; otherwise the footer and bottom border are silently
    // sliced off on terminals under ~42 rows.
    const available = Math.floor(this.tui.terminal.rows * 0.8) - CHROME_ROWS;
    return Math.max(MIN_VIEWPORT_ROWS, Math.min(available, MAX_VIEWPORT_ROWS));
  }

  // Renders the floating comment box over the content rows at
  // commentBoxPlacement: occluded rows are replaced in place, not pushed
  // down. The placement clamps the box within the content rows, and
  // framePanel puts the footer directly below `rows`, so the box never
  // crosses the border or footer. Anchor: the active selection in annotate
  // flow; the cursor line when editing a pending draft (no selection).
  private overlayCommentBox(rows: string[], first: number, inner: number): void {
    const vh = rows.length;
    const sel = this.activeSelection();
    const topLine = sel ? sel.startLine : this.state.cursor.line;
    const bottomLine = sel ? sel.endLine : this.state.cursor.line;
    const colLine = sel ? sel.startLine : this.state.cursor.line;
    const selRawCol = sel ? sel.startCol : this.state.cursor.col;

    // Fit the box to its content (at least as wide as the title needs) and
    // cap it at the viewport: when the comment grows past the viewport, the
    // last lines stay visible (that is where typing lands).
    const textLines = (this.state.comment?.text ?? "").split("\n");
    const capped = textLines.slice(Math.max(0, textLines.length - Math.max(1, vh - 2)));
    const widest = Math.max(...capped.map((l) => visibleWidth(l)), 0);
    const boxW = Math.min(inner, Math.max(widest + 3, COMMENT_BOX_TITLE.length + 6));
    const box = frameCommentBox(capped, boxW, this.colors, COMMENT_BOX_TITLE);

    const anchorRow = (line: number) => Math.min(Math.max(line - first, 0), Math.max(0, vh - 1));
    const selTop = anchorRow(topLine);
    const selBottom = anchorRow(bottomLine);
    const selCol = gutterWidth(this.file.lines.length) + rawColToDisplayCol(this.file.lines[colLine] ?? "", selRawCol);
    // commentBoxPlacement clamps the box inside the viewport [0, viewH - boxH]
    // and against the right border, so border and footer rows stay clear.
    const place = commentBoxPlacement(selTop, selBottom, selCol, box.length, boxW, inner, vh);
    // Degenerate viewports of 1-2 rows cannot fit the 3-row minimum box; the
    // placement clamps the top, and rows past the viewport stay untouched.
    for (let k = 0; k < box.length; k++) {
      const idx = place.top + k;
      if (idx >= vh) continue;
      const base = rows[idx];
      rows[idx] = sliceByColumn(base, 0, place.left) + box[k] + sliceByColumn(base, place.left + boxW, inner - place.left - boxW);
    }
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

  // "N * " style gutter; line numbers are 1-based (see message.ts). The
  // pending marker column uses the theme warning color.
  private gutter(line: number): string {
    const digits = String(Math.max(1, this.file.lines.length)).length;
    const marked = this.pending().some((r) => r.startLine <= line && line <= r.endLine);
    return String(line + 1).padStart(digits) + " " + (marked ? this.colors.warning("*") : " ") + " ";
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

    const content = applyStyleSpans(base, spans, this.spanStyles);
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
