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

import { FOOTER_HINTS, commentBoxPlacement, draftAtCursor, frameCommentBox, framePanel } from "./card-chrome.ts";
import type { CardMode, ChromeColors } from "./card-chrome.ts";
import { INVERSE_OFF, INVERSE_ON, withCursorCell, wrapCommentLines } from "./comment-input.ts";
import { displayPath } from "./message.ts";
import { normalize } from "./selection.ts";
import type { Range, VisualMode } from "./selection.ts";
import { reduceViewer } from "./viewer-state.ts";
import type { PendingDraft, ViewerMode, ViewerState } from "./viewer-state.ts";

const DEFAULT_TAB_SIZE = 4;
const UNDERLINE_ON = "\x1b[4m";
const UNDERLINE_OFF = "\x1b[24m";

// File-area height budget: the panel chrome fixes 3 rows (top + bottom
// border, footer), and the card is capped on tall terminals. The floating
// comment box occludes content rows and does not consume this budget.
const MIN_VIEWPORT_ROWS = 1;
const CHROME_ROWS = 3;
const MAX_VIEWPORT_ROWS = 30;

// The comment box title (read-only previews in Task 4 reuse the same title).
const COMMENT_BOX_TITLE = "Comment";

// Hover preview cap: 6 box rows including the 2 borders, i.e. at most 4
// comment lines (spec goal 7). The editor box instead caps at 8 rows.
const PREVIEW_MAX_INNER_ROWS = 4;

// The comment EDITOR box: fixed width (it never resizes while typing; long
// lines soft-wrap instead) and an 8-row height cap (6 content rows), with a
// scroll window that keeps the cursor's row visible.
const EDITOR_BOX_MAX_WIDTH = 64;
const EDITOR_MAX_INNER_ROWS = 6;

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

// Pending gutter marker: the Nerd Font comment bubble followed by the number
// of pending drafts covering the line ("+" above 9), or a blank 2-cell field
// when the line has none. NF Mono renders the icon in exactly 1 cell, so the
// field is a fixed 2 columns (icon + count digit); no width measuring for it.
export const PENDING_ICON = "\u{F075}"; // nf-fa-comment
const MARKER_FIELD_WIDTH = 2; // icon (1 cell) + count digit (1 cell)

// Gutter width for a file with lineCount lines: right-aligned line number
// (width of the largest 1-based number), a space, the pending-marker field
// (always present, blank when the line has no drafts, so line numbers never
// shift horizontally), and a space. Must stay in sync with AnnotateCard.gutter.
export function gutterWidth(lineCount: number): number {
  return String(Math.max(1, lineCount)).length + MARKER_FIELD_WIDTH + 2;
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
  // stays open show their gutter marker + underline immediately.
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
      // Transparent background by design: pi-tui overlays repaint every cell
      // they occupy, so nothing behind the card can bleed through.
      bg: (s) => s,
      border: (s) => theme.fg("border", s),
      dim: (s) => theme.fg("dim", s),
      accent: (s) => theme.fg("accent", s),
      warning: (s) => theme.fg("warning", s),
    };
    // Inverse and underline stay raw ANSI (theme-neutral): inverse is the
    // cursor/selection highlight, SGR 4 underlines pending ranges; the
    // pending gutter marker keeps the theme warning color.
    this.spanStyles = {
      inverse: (s) => INVERSE_ON + s + INVERSE_OFF,
      underline: (s) => UNDERLINE_ON + s + UNDERLINE_OFF,
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
      previewOn: true,
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
    else if (this.state.mode === "normal" && this.state.previewOn) this.overlayPreview(rows, first, inner);

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

  // Renders the floating comment box over the content rows: occluded rows
  // are replaced in place, not pushed down. Anchor: the active selection in
  // annotate flow; the cursor line when editing a pending draft (no
  // selection). The editor box is fixed-width with soft-wrapped content and
  // an emulated inverse cursor; painting and placement are shared with the
  // normal-mode preview via paintCommentBox.
  private overlayCommentBox(rows: string[], first: number, inner: number): void {
    const sel = this.activeSelection();
    const anchor = sel
      ? { topLine: sel.startLine, bottomLine: sel.endLine, colLine: sel.startLine, rawCol: sel.startCol }
      : {
          topLine: this.state.cursor.line,
          bottomLine: this.state.cursor.line,
          colLine: this.state.cursor.line,
          rawCol: this.state.cursor.col,
        };
    // Fixed-width editor: the box never resizes while typing; the text
    // soft-wraps to the box's inner content width instead.
    const boxW = Math.min(inner, EDITOR_BOX_MAX_WIDTH);
    const text = this.state.comment?.text ?? "";
    const wrapped = wrapCommentLines(text, Math.max(1, boxW - 2), text.length);
    // Height = wrapped rows + 2 borders, capped at 8 rows (and at what the
    // viewport can hold). The scroll window keeps the cursor's row visible.
    const maxInner = Math.min(EDITOR_MAX_INNER_ROWS, Math.max(1, Math.min(wrapped.lines.length, rows.length - 2)));
    const start = Math.max(0, Math.min(wrapped.cursorRow - (maxInner - 1), wrapped.lines.length - maxInner));
    const shown = wrapped.lines.slice(start, start + maxInner);
    const cursorRow = wrapped.cursorRow - start;
    if (cursorRow >= 0 && cursorRow < shown.length) {
      shown[cursorRow] = withCursorCell(shown[cursorRow], wrapped.cursorCol);
    }
    this.paintCommentBox(rows, first, inner, shown, boxW, anchor);
  }

  // Normal-mode hover preview: read-only Comment box for the draft under the
  // cursor (most recent wins, the same column-precise targeting rule as c/x).
  // Anchored to the cursor line and aligned to the draft's start display
  // column; comment lines are capped at PREVIEW_MAX_INNER_ROWS (head kept),
  // the box stays content-sized, and no cursor is rendered (read-only). The
  // render caller gates on previewOn, so preview-off renders nothing;
  // comment mode never reaches here, so the edit flow replaces the preview.
  private overlayPreview(rows: string[], first: number, inner: number): void {
    const draft = draftAtCursor(this.state.cursor.line, this.state.cursor.col, this.pendingDrafts());
    if (draft === undefined) return;
    const capped = draft.comment.split("\n").slice(0, PREVIEW_MAX_INNER_ROWS);
    const widest = Math.max(...capped.map((l) => visibleWidth(l)), 0);
    const boxW = Math.min(inner, Math.max(widest + 3, COMMENT_BOX_TITLE.length + 6));
    this.paintCommentBox(rows, first, inner, capped, boxW, {
      topLine: this.state.cursor.line,
      bottomLine: this.state.cursor.line,
      colLine: draft.range.startLine,
      rawCol: draft.range.startCol,
    });
  }

  // Paints a floating Comment box of the given width over the content rows
  // at commentBoxPlacement: occluded rows are replaced in place, not pushed
  // down. The anchor is expressed in file lines (clamped to the viewport
  // here) plus a raw column resolved on colLine, so the editor (selection or
  // cursor) and the preview (cursor line, draft start column) share one
  // placement path.
  private paintCommentBox(
    rows: string[],
    first: number,
    inner: number,
    textLines: string[],
    boxW: number,
    anchor: { topLine: number; bottomLine: number; colLine: number; rawCol: number },
  ): void {
    const vh = rows.length;
    const box = frameCommentBox(textLines, boxW, this.colors, COMMENT_BOX_TITLE);

    const anchorRow = (line: number) => Math.min(Math.max(line - first, 0), Math.max(0, vh - 1));
    const selTop = anchorRow(anchor.topLine);
    const selBottom = anchorRow(anchor.bottomLine);
    const selCol = gutterWidth(this.file.lines.length) + rawColToDisplayCol(this.file.lines[anchor.colLine] ?? "", anchor.rawCol);
    // commentBoxPlacement clamps the box inside the viewport [0, viewH - boxH]
    // and against the right border, so border and footer rows stay clear.
    const place = commentBoxPlacement(selTop, selBottom, selCol, box.length, boxW, inner, vh);
    // Degenerate viewports of 1-2 rows cannot fit the 3-row minimum box; the
    // placement clamps the top, and rows past the viewport stay untouched.
    for (let k = 0; k < box.length; k++) {
      const idx = place.top + k;
      if (idx >= vh) continue;
      const base = rows[idx];
      // The left sliver may end mid-SGR-run (e.g. an underline the box edge
      // cuts in half); close underline + inverse so the box border glyphs do
      // not inherit the open attributes. The right sliver re-opens its
      // carried state itself (sliceByColumn).
      rows[idx] =
        sliceByColumn(base, 0, place.left) + UNDERLINE_OFF + INVERSE_OFF + box[k] + sliceByColumn(base, place.left + boxW, inner - place.left - boxW);
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

  // Gutter for one file line: right-aligned 1-based line number (see
  // message.ts), a space, the pending-marker field, and a space. The field is
  // always MARKER_FIELD_WIDTH display columns (blank when no draft covers the
  // line) so line numbers never shift horizontally; when drafts cover the
  // line it shows PENDING_ICON plus the draft count ("+" above 9) in the
  // theme warning color.
  private gutter(line: number): string {
    const digits = String(Math.max(1, this.file.lines.length)).length;
    const count = this.pending().filter((r) => r.startLine <= line && line <= r.endLine).length;
    const field = count === 0
      ? " ".repeat(MARKER_FIELD_WIDTH)
      : this.colors.warning(PENDING_ICON + (count > 9 ? "+" : String(count)));
    return String(line + 1).padStart(digits) + " " + field + " ";
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
