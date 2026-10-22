// AnnotateCard: the pi-tui Component rendering the file card for the
// /annotate flow. Thin shell over the pure viewer state machine
// (state.ts): handleInput feeds reduceViewer and dispatches its
// effects (annotate/update/delete/close). Rendering frames the file as a
// bordered panel via the card-chrome helpers (framePanel, frameCommentBox,
// commentBoxPlacement) with the two-row bottom area from status-line.ts
// (renderStatusLine, renderCommandLine); all chrome colors come from the pi
// theme passed by the ctx.ui.custom factory, and syntax colors come from
// pi's highlightCode with the same theme.

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { commentBoxPlacement, frameCommentBox, framePanel, PAD_X, spliceRow } from "../tui/card-chrome.ts";
import type { ChromeColors } from "../tui/card-chrome.ts";
import { completionCandidates, renderCompletionClosing, renderCompletionDivider, renderCompletionRows } from "./completion-panel.ts";
import { INVERSE_OFF, INVERSE_ON, withCursorCell, wrapCommentLines } from "../tui/comment-input.ts";
import { rawColToDisplayCol, rawColsToDisplayCols, sliceWindow, tabExpanded } from "../tui/display.ts";
import { displayPath } from "../core/message.ts";
import { compilePattern, findMatches } from "../core/search.ts";
import { normalize } from "../core/selection.ts";
import type { Range, VisualMode } from "../core/selection.ts";
import { CHROME_ROWS, clampScrollLeft, COMMENT_BOX_TITLE, EDITOR_BOX_MAX_WIDTH, EDITOR_MAX_INNER_ROWS, MARKER_FIELD_WIDTH, MAX_VIEWPORT_ROWS, MIN_VIEWPORT_ROWS, PREVIEW_MAX_INNER_ROWS, gutterWidth } from "./layout.ts";
import { applyStyleSpans, BOLD_ON, DIM_ON, INTENSITY_OFF, UNDERLINE_OFF, UNDERLINE_ON } from "./line-style.ts";
import type { SpanStyle, StyleSpan } from "./line-style.ts";
import { pendingKeysOf, stackAtCursor } from "./movement.ts";
import { reduceViewer } from "./state.ts";
import type { PendingDraft, ViewerMode, ViewerState } from "./state.ts";
import { cardModeOf, renderCommandLine, renderStatusLine } from "./status-line.ts";
import type { StatusLineInput } from "./status-line.ts";

// Pending gutter marker: the Nerd Font comment bubble followed by the number
// of pending drafts STARTING on the line ("+" above 9), shown only on a
// draft's start line so the gutter counts sum to the title bar's (N) (spec
// section 3). Lines a draft covers without starting there show the dim
// CONTINUATION_MARK instead; a line that both starts a draft and continues
// another keeps the icon (start wins). The icon glyph is WIDER than one cell
// in many patched fonts (wcwidth says 1, the glyph bleeds right), so a spacer
// cell separates it from the count digit; on true NF Mono fonts the spacer
// just looks like a gap.
export const PENDING_ICON = "\u{F075}"; // nf-fa-comment
// Continuation marker: a dim vertical bar centered in the marker field.
export const CONTINUATION_MARK = "\u{2502}"; // box drawings light vertical

// (cardModeOf and the FOOTER_HINTS table it keys into live in status-line.ts.)

// Kitty keyboard protocol event-type 2 (repeat) sequences rewritten to the
// equivalent press form, so held functional keys repeat under pi-tui's kitty
// mode (presses arrive legacy, repeats arrive as event type 2). The rewrite
// fires only when the ENTIRE input is exactly one repeat sequence (single
// anchored match, never a global replace): the `:<event>` field is dropped,
// and a modifier field of 1 (no real modifier) is dropped too - for the
// letter-final form a surviving bare parameter "1" is dropped with it,
// collapsing to "\x1b[A" rather than "\x1b[1A". Real modifiers (field > 1)
// are kept, only the event field is stripped. Everything else passes through
// unchanged (presses, releases - filtered upstream anyway, plain text, and
// the bracketed-paste brackets \x1b[200~ / \x1b[201~).
const KITTY_REPEAT = /^\x1b\[(\d+);(\d+):2([A-Z~u])$/;

export function normalizeKeyRepeat(data: string): string {
  const m = KITTY_REPEAT.exec(data);
  if (m === null) return data;
  const [, first, mod, final] = m;
  if (mod === "1") {
    // Letter-final form: "\x1b[1;1:2A" collapses to "\x1b[A"; tilde and
    // CSI-u forms keep their leading parameter ("\x1b[5;1:2~" -> "\x1b[5~").
    return first === "1" && final !== "~" && final !== "u" ? `\x1b[${final}` : `\x1b[${first}${final}`;
  }
  return `\x1b[${first};${mod}${final}`;
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
  // Maximum display width across all loaded lines (tabs expanded, wide chars
  // counted double), computed once at construction: the file is fixed for the
  // card's lifetime, and the reducer clamps scrollLeft against it.
  private readonly maxLineWidth: number;
  private state: ViewerState;
  // Inner width of the latest render(width) call (null before the first
  // render); contentWidth() derives the reducer's horizontal budget from it.
  private renderedInner: number | null = null;

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
    onUpdateComment: (draftId: string, comment: string) => void = () => { },
    onDeleteDraft: (draftId: string) => void = () => { },
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
    // Inverse stays raw ANSI (theme-neutral): the cursor/selection highlight.
    // Pending ranges underline with raw SGR 4; the cycle target's range adds
    // SGR 1 bold + the theme warning fg, and non-target stack members dim
    // their underline (SGR 2). Search matches (hlsearch) mirror pi's
    // two-level theme convention: plain matches paint searchMatchBg over
    // searchMatchText, and the match under the cursor ("current") wraps
    // that in bold + inverse (pi's searchCurrentMatchStyle) - theme-
    // adaptive, distinct from the raw inverse of cursor/selection,
    // composing with pending underlines.
    // The pending gutter marker keeps the theme warning color.
    this.spanStyles = {
      inverse: (s) => INVERSE_ON + s + INVERSE_OFF,
      underline: (s) => UNDERLINE_ON + s + UNDERLINE_OFF,
      target: (s) => this.colors.warning(BOLD_ON + UNDERLINE_ON + s + INTENSITY_OFF + UNDERLINE_OFF),
      dimUnderline: (s) => DIM_ON + UNDERLINE_ON + s + INTENSITY_OFF + UNDERLINE_OFF,
      match: (s) => theme.bg("searchMatchBg", theme.fg("searchMatchText", s)),
      // pi's own searchCurrentMatchStyle: bold + inverse over the plain
      // pair (the runtime partitions fg/bg tokens, so swapping them throws;
      // SGR inverse is the only theme-safe inversion).
      matchCurrent: (s) => theme.bold(theme.inverse(theme.bg("searchMatchBg", theme.fg("searchMatchText", s)))),
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
      scrollLeft: 0,
      comment: null,
      pending: null,
      visualMode: "char",
      editingDraftId: null,
      previewOn: true,
      search: null,
      lastSearch: null,
      count: null,
      message: null,
    };
    // A reduce loop, not Math.max(...lines.map(...)): the spread form throws
    // RangeError past V8's argument-count limit on very large files.
    this.maxLineWidth = file.lines.reduce((max, l) => Math.max(max, rawColToDisplayCol(l, l.length)), 0);
  }

  render(width: number): string[] {
    const inner = width - 2; // one border column on each side
    this.renderedInner = inner;
    // Content budget between the padding columns framePanel reserves inside
    // the vertical borders (PAD_X): every content width below derives from
    // it so no rendered cell touches a border glyph.
    const contentW = inner - 2 * PAD_X;
    const vh = this.viewportHeight();
    const lines = this.file.lines;
    const first = Math.min(Math.max(this.state.scrollTop, 0), Math.max(0, lines.length - 1));
    const last = Math.min(lines.length, first + vh);
    const selection = this.activeSelection();
    const cursorOn = this.state.mode !== "comment";

    // Target emphasis is resolved once per frame (normal mode only): the
    // cycle target's ranges vs the other stacked drafts (spec section 2).
    const emphasis = this.pendingEmphasis();
    // Search highlight (hlsearch) is resolved once per frame: search mode
    // follows the live query (empty skips), every other mode repeats the
    // last submitted pattern (null skips). One compile + one scan per
    // render; an invalid pattern renders no highlight (its error already
    // shows as the cmdline message). :nohlsearch (searchHL false) suppresses
    // the whole pass: the query resolves to null, so no spans compile and
    // searchStatus is never supplied; undefined means true, so the default
    // path is byte-identical. Spans are built only for viewport rows
    // [first, last): off-screen spans are never read. Zero-width matches
    // render nothing (applyStyleSpans' end > start filter), so they are
    // skipped here - that keeps pathological patterns like a* cheap. Per
    // line the sorted match columns map in ONE left-to-right walk
    // (rawColsToDisplayCols), so a frame costs O(file) for the scan plus
    // O(viewport lines) for mapping instead of O(matches x line length).
    const hlOn = this.state.searchHL !== false;
    const query = hlOn ? (this.state.mode === "search" ? this.state.search?.query ?? "" : this.state.lastSearch ?? null) : null;
    const matchSpans = new Map<number, StyleSpan[]>();
    let searchStatus: StatusLineInput["search"] = null;
    if (query !== null && query !== "") {
      const compiled = compilePattern(query);
      if (compiled.ok) {
        const matches = findMatches(lines, compiled.re);
        // The match containing the cursor is the "current" one (pi's
        // two-level searchMatch convention): bold + inverse over the plain
        // pair, so the cursor's match pops over the plain hlsearch marks.
        // Zero-width matches never contain the cursor.
        const currentIdx = matches.findIndex((m) =>
          m.line === this.state.cursor.line && m.startCol <= this.state.cursor.col
            && this.state.cursor.col < m.endCol
        );
        // findMatches emits matches grouped by line, sorted by startCol.
        let mi = 0;
        while (mi < matches.length) {
          const line = matches[mi].line;
          let mj = mi + 1;
          while (mj < matches.length && matches[mj].line === line) mj++;
          if (line >= first && line < last) {
            const cols: number[] = [];
            const refs: number[] = []; // global match index per kept span
            for (let g = mi; g < mj; g++) {
              const m = matches[g];
              if (m.endCol <= m.startCol) continue; // zero-width renders nothing
              refs.push(g);
              cols.push(m.startCol, m.endCol);
            }
            if (refs.length > 0) {
              const disp = rawColsToDisplayCols(lines[line] ?? "", cols);
              matchSpans.set(line, refs.map((g, r) => ({
                start: disp[2 * r],
                end: disp[2 * r + 1],
                style: g === currentIdx ? "matchCurrent" as const : "match" as const,
              })));
            }
          }
          mi = mj;
        }
        // Segment input (normal with a lastSearch, and search modes only):
        // rank is the 1-based index of the match containing the cursor;
        // zero-width matches never contain it, and 0 means the cursor sits
        // on no match. Zero matches hide the segment entirely - the
        // "Pattern not found" transient message carries that state instead
        // of a meaningless [0/0].
        if ((this.state.mode === "normal" || this.state.mode === "search") && matches.length > 0) {
          searchStatus = { pattern: query, rank: currentIdx + 1, total: matches.length };
        }
      }
    }
    // Horizontal window for this frame: the state's scrollLeft can be stale
    // (e.g. a terminal resize without a keypress), so it is re-clamped
    // against THIS frame's content width before slicing any row.
    const gutterW = gutterWidth(lines.length);
    const cw = Math.max(1, contentW - gutterW);
    const sl = clampScrollLeft(this.state.scrollLeft ?? 0, this.maxLineWidth, cw);
    // Content rows are windowed to the content width, then space-padded to
    // it so the floating comment box can replace exact display-column
    // slices below.
    const rows: string[] = [];
    for (let i = first; i < last; i++) {
      rows.push(this.renderRow(i, selection, cursorOn, emphasis, matchSpans.get(i) ?? [], sl, cw, contentW));
    }
    if (this.state.mode === "comment") this.overlayCommentBox(rows, first, contentW, sl);
    else if (this.state.mode === "normal" && this.state.previewOn) this.overlayPreview(rows, first, contentW, sl);
    else if (this.state.mode === "command") this.overlayCompletion(rows, contentW);

    const count = this.pending().length;
    const title = "Annotate: " + displayPath(this.file.path, this.cwd) + (count > 0 ? ` (${count})` : "");
    // Two-row bottom area (spec): the statusline (mode badge, visual
    // selection range, 1-based cursor position in display columns) above
    // the cmdline (per-mode hints). The selection rides only in visual
    // modes; activeSelection's normalize already puts the smaller position
    // first, and rawColToDisplayCol preserves that order. Range.endCol is
    // an end-exclusive slice bound (cursor char included), so the displayed
    // end position is the LAST selected char (endCol - 1, 1-based) - the
    // spec's example shows the range end equal to the cursor position.
    const cursorLine = lines[this.state.cursor.line] ?? "";
    const visual = this.state.mode === "visual-char" || this.state.mode === "visual-line";
    const statusSel: StatusLineInput["selection"] =
      visual && selection !== null
        ? {
          start: { line: selection.startLine + 1, col: rawColToDisplayCol(lines[selection.startLine] ?? "", selection.startCol) + 1 },
          end: { line: selection.endLine + 1, col: rawColToDisplayCol(lines[selection.endLine] ?? "", Math.max(0, selection.endCol - 1)) + 1 },
          kind: this.state.visualMode === "line" ? "line" : "char",
        }
        : null;
    const statusline = renderStatusLine(
      {
        mode: cardModeOf(this.state.mode),
        cursor: { line: this.state.cursor.line + 1, col: rawColToDisplayCol(cursorLine, this.state.cursor.col) + 1 },
        selection: statusSel,
        search: searchStatus,
      },
      contentW,
      this.colors,
    );
    // Cmdline: search mode shows the / input itself (the emulated cursor
    // cell rides at the end of the query) and command mode mirrors it with
    // the : prompt and the typed line (the reducer owns every keystroke;
    // the shell only paints); every other mode shows the
    // per-mode hints, carrying the reducer's transient message (it survives
    // exactly one render, right-aligned) and the showcmd string derived
    // from the same state, which the renderer drops while a message owns
    // the corner (and never shows on the input row).
    const searchInput = this.state.mode === "search" ? this.state.search ?? null : null;
    const commandInput = this.state.mode === "command" ? this.state.command ?? null : null;
    const cmdline = searchInput !== null
      ? renderCommandLine(
        { kind: "input", prompt: "/", value: searchInput.query, cursorCol: searchInput.query.length, message: this.state.message ?? null },
        contentW,
        this.colors,
      )
      : commandInput !== null
        ? renderCommandLine(
          { kind: "input", prompt: ":", value: commandInput.value, cursorCol: commandInput.value.length, message: this.state.message ?? null },
          contentW,
          this.colors,
        )
      : renderCommandLine(
        { kind: "hints", mode: cardModeOf(this.state.mode), message: this.state.message ?? null, pendingKeys: pendingKeysOf(this.state) },
        contentW,
        this.colors,
      );
    return framePanel(rows, width, { title, footers: [statusline, cmdline], colors: this.colors });
  }

  // One content row, windowed horizontally: the gutter stays fixed while the
  // already-styled line is sliced to the display-column window [sl, sl+cw)
  // (strict, so a wide char straddling the left edge becomes a placeholder
  // space and one straddling the right edge is dropped whole, and the row
  // is never half-rendered). No edge indicators: vim's default listchars
  // enables neither 'extends' nor 'precedes', and sandbox trials showed the
  // chevron/dots caused more confusion than value. The inverse cursor cell
  // is styled inside renderLine before slicing; the follow logic
  // (reduceViewer) guarantees it sits inside the window.
  private renderRow(
    line: number,
    selection: Range | null,
    cursorOn: boolean,
    emphasis: Map<Range, SpanStyle>,
    matchSpans: StyleSpan[],
    sl: number,
    cw: number,
    contentW: number,
  ): string {
    const styled = this.renderLine(line, selection, cursorOn, emphasis, matchSpans);
    const windowed = sliceWindow(styled, sl, Math.max(0, cw));
    // A span ending exactly at the window's right edge (e.g. the inverse
    // cursor cell on the last window cell) loses its closing SGR to the
    // slice; reset explicitly so inverse/underline cannot bleed into the
    // padding that follows.
    const row = this.gutter(line) + windowed + (windowed.includes("\x1b[") ? "\x1b[0m" : "");
    return row + " ".repeat(Math.max(0, contentW - visibleWidth(row)));
  }

  handleInput(data: string): void {
    // Kitty repeat sequences become presses first (held arrows must scroll);
    // then the legacy normalization below maps escape/ctrl+j flavors.
    data = normalizeKeyRepeat(data);
    // Terminals in kitty keyboard mode deliver the Escape key as a CSI-u
    // sequence (e.g. "\x1b[27u") instead of a bare "\x1b", and modifier
    // combinations like ctrl+j / shift+enter as CSI-u too. Normalize every
    // flavor to the legacy bytes the reducer understands.
    const key = matchesKey(data, "escape")
      ? "\x1b"
      : this.state.mode === "comment" &&
        (matchesKey(data, "ctrl+j") || matchesKey(data, "shift+enter"))
        ? "\n"
        : data;
    const result = reduceViewer(
      this.state,
      key,
      this.file.lines,
      { height: this.viewportHeight(), contentWidth: this.contentWidth(), maxLineWidth: this.maxLineWidth },
      this.pendingDrafts(),
    );
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

  invalidate(): void { }

  // Terminal rows minus the panel chrome (top + bottom border + statusline
  // + cmdline), clamped to the file-area budget. The floating comment box
  // occludes content rows and does NOT consume viewport budget, so this is
  // comment-mode independent.
  private viewportHeight(): number {
    // pi-tui clips overlays to floor(0.8 * terminal rows) when maxHeight is
    // "80%", so budget against the overlay height rather than the full
    // terminal height; otherwise the footer and bottom border are silently
    // sliced off on terminals under ~42 rows.
    const available = Math.floor(this.tui.terminal.rows * 0.8) - CHROME_ROWS;
    return Math.max(MIN_VIEWPORT_ROWS, Math.min(available, MAX_VIEWPORT_ROWS));
  }

  // Content width for the reducer's horizontal follow: the latest render's
  // inner width minus the padding columns and the gutter. Before the first
  // render() the inner width is estimated from the same terminal-size source
  // viewportHeight() uses (the 80% overlay budget of the terminal width,
  // minus the 2 border columns); a wrong estimate only mis-aims one follow
  // step - the next cursor-moving key re-clamps against the freshly rendered
  // width.
  private contentWidth(): number {
    const inner = this.renderedInner ?? Math.floor(this.tui.terminal.columns * 0.8) - 2;
    return Math.max(1, inner - 2 * PAD_X - gutterWidth(this.file.lines.length));
  }

  // Renders the floating comment box over the content rows: occluded rows
  // are replaced in place, not pushed down. Anchor: the active selection in
  // annotate flow; the cursor line when editing a pending draft (no
  // selection). The editor box is fixed-width with soft-wrapped content and
  // an emulated inverse cursor; painting and placement are shared with the
  // normal-mode preview via paintCommentBox.
  private overlayCommentBox(rows: string[], first: number, contentW: number, sl: number): void {
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
    // soft-wraps to the box's content budget (its width minus the 2 borders
    // and the PAD_X padding) instead.
    const boxW = Math.min(contentW, EDITOR_BOX_MAX_WIDTH);
    const text = this.state.comment?.text ?? "";
    const wrapped = wrapCommentLines(text, Math.max(1, boxW - 2 - 2 * PAD_X), text.length);
    // Height = wrapped rows + 2 borders, capped at 8 rows (and at what the
    // viewport can hold). The scroll window keeps the cursor's row visible.
    const maxInner = Math.min(EDITOR_MAX_INNER_ROWS, Math.max(1, Math.min(wrapped.lines.length, rows.length - 2)));
    const start = Math.max(0, Math.min(wrapped.cursorRow - (maxInner - 1), wrapped.lines.length - maxInner));
    const shown = wrapped.lines.slice(start, start + maxInner);
    const cursorRow = wrapped.cursorRow - start;
    if (cursorRow >= 0 && cursorRow < shown.length) {
      shown[cursorRow] = withCursorCell(shown[cursorRow], wrapped.cursorCol);
    }
    this.paintCommentBox(rows, first, contentW, shown, boxW, anchor, COMMENT_BOX_TITLE, sl);
  }

  // Tab-triggered completion drawer: it exists only while the Tab-cycling
  // state is active (typing alone paints nothing). The labeled divider opens
  // the drawer, the candidate rows follow, and a plain closing rule seals it
  // beneath, replacing the bottom-most body rows while the
  // statusline/cmdline footers (separate framePanel rows) are never
  // displaced, badge and position included. At most MAX_COMPLETION_ROWS + 2
  // body lines are covered, transiently. Render only: the reducer owns Tab
  // and the cycling state; nothing here feeds the drawer back into input.
  private overlayCompletion(rows: string[], contentW: number): void {
    if ((this.state.command?.completion ?? null) === null) return;
    const panel = completionCandidates(this.state);
    if (panel.rows.length === 0) return;
    const block = [
      renderCompletionDivider(panel, contentW, this.colors),
      ...renderCompletionRows(panel, contentW, this.colors),
      renderCompletionClosing(contentW, this.colors),
    ];
    const count = Math.min(block.length, rows.length);
    for (let k = 0; k < count; k++) rows[rows.length - count + k] = block[k];
  }

  // Normal-mode hover preview: read-only Comment box for the CURRENT cycle
  // target under the cursor (spec section 2). On a stack of 2+ drafts the
  // title gains a 1-based positional indicator "(i/n)" (newest = 1); a lone
  // draft keeps the plain title. Anchored to the cursor line and aligned to
  // the target's start display column; comment lines are capped at
  // PREVIEW_MAX_INNER_ROWS (head kept), the box stays content-sized, and no
  // cursor is rendered (read-only). The render caller gates on previewOn, so
  // preview-off renders nothing; comment mode never reaches here, so the
  // edit flow replaces the preview.
  private overlayPreview(rows: string[], first: number, contentW: number, sl: number): void {
    const stack = stackAtCursor(this.state.cursor.line, this.state.cursor.col, this.pendingDrafts());
    if (stack.length === 0) return;
    // The same target the reducer edits via c/x: stack[ordinal % length].
    const ordinal = (this.state.cycleOrdinal ?? 0) % stack.length;
    const draft = stack[ordinal];
    const title = stack.length >= 2 ? `${COMMENT_BOX_TITLE} (${ordinal + 1}/${stack.length})` : COMMENT_BOX_TITLE;
    const capped = draft.comment.split("\n").slice(0, PREVIEW_MAX_INNER_ROWS);
    const widest = Math.max(...capped.map((l) => visibleWidth(l)), 0);
    const boxW = Math.min(contentW, Math.max(widest + 3 + 2 * PAD_X, title.length + 6));
    this.paintCommentBox(rows, first, contentW, capped, boxW, {
      topLine: this.state.cursor.line,
      bottomLine: this.state.cursor.line,
      colLine: draft.range.startLine,
      rawCol: draft.range.startCol,
    }, title, sl);
  }

  // Paints a floating Comment box of the given width over the content rows
  // at commentBoxPlacement: occluded rows are replaced in place, not pushed
  // down. The anchor is expressed in file lines (clamped to the viewport
  // here) plus a raw column resolved on colLine, so the editor (selection or
  // cursor) and the preview (cursor line, draft start column) share one
  // placement path. The column is scroll-corrected (minus the frame's
  // clamped scrollLeft) so the box stays anchored to the anchor's on-screen
  // cell instead of drifting right by the scrolled-away columns. The editor
  // keeps the default title; the preview passes its positional
  // "Comment (i/n)" title.
  private paintCommentBox(
    rows: string[],
    first: number,
    contentW: number,
    textLines: string[],
    boxW: number,
    anchor: { topLine: number; bottomLine: number; colLine: number; rawCol: number },
    title: string = COMMENT_BOX_TITLE,
    sl: number = 0,
  ): void {
    const vh = rows.length;
    const box = frameCommentBox(textLines, boxW, this.colors, title);

    const anchorRow = (line: number) => Math.min(Math.max(line - first, 0), Math.max(0, vh - 1));
    const selTop = anchorRow(anchor.topLine);
    const selBottom = anchorRow(anchor.bottomLine);
    const selCol = gutterWidth(this.file.lines.length) + rawColToDisplayCol(this.file.lines[anchor.colLine] ?? "", anchor.rawCol) - sl;
    // commentBoxPlacement clamps the box inside the viewport [0, viewH - boxH]
    // and against the content budget, so border, padding, and footer rows
    // stay clear.
    const place = commentBoxPlacement(selTop, selBottom, selCol, box.length, boxW, contentW, vh);
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
      rows[idx] = spliceRow(base, place.left, boxW, UNDERLINE_OFF + INVERSE_OFF + box[k]);
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
  // always MARKER_FIELD_WIDTH display columns so line numbers never shift
  // horizontally. Spec section 3 semantics: lines where one or more drafts
  // START show PENDING_ICON plus that start count ("+" above 9) in the theme
  // warning color (start wins over continuation); lines merely COVERED by a
  // draft show a dim vertical bar centered in the field; uncovered lines stay
  // blank. The start counts sum to the title bar's (N).
  private gutter(line: number): string {
    const digits = String(Math.max(1, this.file.lines.length)).length;
    const starts = this.pending().filter((r) => r.startLine === line).length;
    const covered = this.pending().some((r) => r.startLine <= line && line <= r.endLine);
    const field = starts > 0
      ? this.colors.warning(PENDING_ICON + " " + (starts > 9 ? "+" : String(starts)))
      : covered
        ? " " + this.colors.dim(CONTINUATION_MARK) + " "
        : " ".repeat(MARKER_FIELD_WIDTH);
    return String(line + 1).padStart(digits) + " " + field + " ";
  }

  // Target emphasis for one frame (spec section 2): maps the RANGE of every
  // draft covering the cursor to its span style - the cycle target's range
  // paints "target" (warning fg + bold + underline) and the other stack
  // members "dimUnderline" (SGR 2). Normal mode only: visual and comment
  // modes return an empty map, so all pending ranges stay plain underline.
  // Keys are the draft range OBJECTS, identical to the pending() ranges
  // (index.ts derives both from the same store entries); ranges absent from
  // the map keep the plain underline.
  private pendingEmphasis(): Map<Range, SpanStyle> {
    const emphasis = new Map<Range, SpanStyle>();
    if (this.state.mode !== "normal") return emphasis;
    const stack = stackAtCursor(this.state.cursor.line, this.state.cursor.col, this.pendingDrafts());
    if (stack.length === 0) return emphasis;
    const ordinal = (this.state.cycleOrdinal ?? 0) % stack.length;
    for (const [k, draft] of stack.entries()) {
      emphasis.set(draft.range, k === ordinal ? "target" : "dimUnderline");
    }
    return emphasis;
  }

  // One file line: highlighted content unless the selection covers the line
  // (selection display wins), then search matches, pending underlines (plain,
  // or the frame's target/dim emphasis where the map says so), then the
  // cursor cell.
  private renderLine(
    line: number,
    selection: Range | null,
    cursorOn: boolean,
    emphasis: Map<Range, SpanStyle>,
    matchSpans: StyleSpan[],
  ): string {
    const raw = this.file.lines[line] ?? "";
    // Search matches go first so the later spans wrap around them: inverse
    // stays the outermost style on any cell it covers.
    const spans: StyleSpan[] = [...matchSpans];

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
      if (span !== null) spans.push({ start: span[0], end: span[1], style: emphasis.get(p) ?? "underline" });
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
