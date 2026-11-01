// Markdown scanner for the annotation viewer: turns raw file lines into
// per-line DisplayScanLine plans without reflowing, hiding, normalizing, or
// concatenating any source text. Block structure comes from the peer-marked
// lexer (re-exported by pi-tui, so no new dependency and no Markdown
// component); block token `raw` values are accepted only at verified
// whole-line boundaries, and inline token `raw` values are accepted only
// through a forward-only verbatim cursor. Anything that cannot be verified
// verbatim degrades to plain text: styling is cosmetic, never positional.
// The output always carries exactly one scan per input raw line, in order,
// even for malformed input or lexer failure (which yields an all-plain
// scan). Literal prefixes are fixed-width space/glyph strings and never
// contain tabs; quote and list continuation prefixes add up exactly.

import { Marked, type Token, type Tokens } from "@earendil-works/pi-tui";
import { tabExpanded } from "../tui/display.ts";
import type { DisplayScanLine, DisplayStyle, MdSpanStyle } from "../tui/display.ts";

// Quote chrome: one glyph plus one space (display width 2). A UI string.
const QUOTE_PREFIX = "\u258E ";

// Scan output plus the raw source lines it plans, so spans clamp against
// true raw line lengths.
interface Ctx {
  lines: string[];
  scans: DisplayScanLine[];
}

// One region of consecutive source lines as seen by a nesting level: region
// line j is source line base + j, and its text is the source line minus the
// ancestor chrome (quote markers, list marker tails), which starts at raw
// column offsets[j]. Trailing carriage returns are stripped for comparison
// only (marked normalizes CRLF), never rewritten in the raw lines.
interface Region {
  base: number;
  offsets: number[];
  texts: string[];
}

function stripTrailingCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// Splits a token raw into its whole-line segments: one entry per source
// line it covers, without the trailing newline that ends the last line.
function rawSegments(raw: string): string[] {
  const segs = raw.split("\n");
  if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop();
  return segs;
}

export function scanMarkdown(lines: string[]): DisplayScanLine[] {
  const scans: DisplayScanLine[] = lines.map(() => ({}));
  if (lines.length === 0) return scans;
  let tokens: Token[];
  try {
    tokens = new Marked().lexer(lines.join("\n"));
  } catch {
    return scans; // lexer failure degrades to an all-plain scan
  }
  const region: Region = {
    base: 0,
    offsets: lines.map(() => 0),
    texts: lines.map(stripTrailingCr),
  };
  const ctx: Ctx = { lines, scans };
  walkBlockTokens(tokens, region, lines.map(() => ""), ctx);
  return scans;
}

// A forward-only verbatim cursor: region line index plus column within it.
// Marked's sibling token raws concatenate exactly to their parent text, but
// a raw that ends without a newline leaves the line open and the next raw
// begins with the newline that closes it, so line counting alone is not
// enough; the column tracks that terminator sharing.
interface Cursor {
  li: number;
  ci: number;
}

function advanceCursor(raw: string, cur: Cursor): void {
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === "\n") {
      cur.li++;
      cur.ci = 0;
    } else {
      cur.ci++;
    }
  }
}

// Walks sibling block tokens left to right over the region with a
// forward-only verbatim cursor. Each token's raw must verify at the cursor;
// on mismatch the token's lines stay plain and the cursor still advances by
// the raw length so later tokens keep their boundaries.
function walkBlockTokens(tokens: Token[], region: Region, prefix: string[], ctx: Ctx): void {
  const cur: Cursor = { li: 0, ci: 0 };
  for (const token of tokens) {
    const raw = token.raw;
    if (raw.length === 0 || cur.li >= region.texts.length) continue;
    const segs = rawSegments(raw);
    const matched = rawMatchesAt(segs, region.texts, cur.li, cur.ci);
    const li = cur.li;
    const ci = cur.ci;
    advanceCursor(raw, cur);
    if (matched) dispatchBlockToken(token, segs, region, li, ci, prefix, ctx);
  }
}

// True when segs match texts verbatim starting at (li, ci): the first
// segment must run to the end of its line when the raw continues past it;
// middle segments are whole lines; the last segment matches a prefix.
function rawMatchesAt(segs: string[], texts: string[], li: number, ci: number): boolean {
  if (li + segs.length > texts.length) return false;
  for (let s = 0; s < segs.length; s++) {
    const text = texts[li + s];
    const seg = segs[s];
    if (s === 0) {
      if (ci + seg.length > text.length || text.slice(ci, ci + seg.length) !== seg) return false;
      if (segs.length > 1 && ci + seg.length !== text.length) return false;
    } else if (s === segs.length - 1) {
      if (!text.startsWith(seg)) return false;
    } else if (text !== seg) {
      return false;
    }
  }
  return true;
}

function dispatchBlockToken(
  token: Token,
  segs: string[],
  region: Region,
  start: number,
  ci: number,
  prefix: string[],
  ctx: Ctx,
): void {
  switch (token.type) {
    case "space":
    case "table":
    case "html":
      return; // blank rows, GFM tables, and raw HTML stay unstyled
    case "heading":
      styleHeading(token, segs, region, start, ctx);
      return;
    case "code":
      styleCode(token, segs, region, start, ctx);
      return;
    case "hr":
      for (let j = 0; j < segs.length; j++) {
        emitLineSpan(region, start + j, j === 0 ? ci : 0, region.texts[start + j].length, "mdHr", ctx);
      }
      return;
    case "def":
      // Link reference definitions render invisible in CommonMark; keeping
      // them visible and wholly dimmed signals "not content".
      for (let j = 0; j < segs.length; j++) {
        emitLineSpan(region, start + j, j === 0 ? ci : 0, region.texts[start + j].length, "mdDim", ctx);
      }
      return;
    case "blockquote":
      // The switch discriminates on type; marked's lexer (no extensions on
      // the bare Marked instance) emits real Tokens.Blockquote here.
      styleBlockquote(token as Tokens.Blockquote, segs, region, start, prefix, ctx);
      return;
    case "list":
      styleList(token, region, start, prefix, ctx);
      return;
    case "paragraph":
    case "text": {
      // tight list items carry their inline tokens in text tokens
      const inline = (token as Tokens.Paragraph | Tokens.Text).tokens ?? [];
      walkInlineTokens(inline, region, start, ctx);
      return;
    }
    default:
      return; // unknown token shapes stay plain
  }
}

function styleHeading(token: Token, segs: string[], region: Region, start: number, ctx: Ctx): void {
  const line = region.texts[start];
  const atx = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line);
  if (atx) {
    emitLineSpan(region, start, 0, atx[0].length, "mdDim", ctx);
    const closer = /[ \t]#{1,6}[ \t]*$/.exec(line.slice(atx[0].length));
    const contentEnd = closer ? atx[0].length + closer.index : line.length;
    if (contentEnd > atx[0].length) emitLineSpan(region, start, atx[0].length, contentEnd, "mdHeading", ctx);
    if (closer) emitLineSpan(region, start, contentEnd, line.length, "mdDim", ctx);
    return;
  }
  // Setext heading: content lines styled, underline row dimmed.
  for (let j = 0; j + 1 < segs.length; j++) {
    emitLineSpan(region, start + j, 0, segs[j].length, "mdHeading", ctx);
  }
  if (segs.length > 1) {
    const underline = start + segs.length - 1;
    emitLineSpan(region, underline, 0, region.texts[underline].length, "mdDim", ctx);
  }
}

function styleCode(token: Token, segs: string[], region: Region, start: number, ctx: Ctx): void {
  const indented = (token as Tokens.Code).codeBlockStyle === "indented";
  if (indented) {
    for (let j = 0; j < segs.length; j++) {
      emitLineSpan(region, start + j, 0, region.texts[start + j].length, "mdCodeBlock", ctx);
    }
    return;
  }
  emitLineSpan(region, start, 0, region.texts[start].length, "mdCodeBlockBorder", ctx);
  const closes = segs.length > 1 && /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(segs[segs.length - 1]);
  const last = closes ? segs.length - 1 : segs.length;
  for (let j = 1; j < last; j++) {
    emitLineSpan(region, start + j, 0, region.texts[start + j].length, "mdCodeBlock", ctx);
  }
  if (closes) emitLineSpan(region, start + last, 0, region.texts[start + last].length, "mdCodeBlockBorder", ctx);
}

function styleBlockquote(token: Tokens.Blockquote, segs: string[], region: Region, start: number, prefix: string[], ctx: Ctx): void {
  const childOffsets: number[] = [];
  const childTexts: string[] = [];
  const childPrefix: string[] = [];
  for (let j = 0; j < segs.length; j++) {
    const line = region.texts[start + j];
    const marker = /^[ \t]{0,3}>[ \t]?/.exec(line);
    const strip = marker ? marker[0].length : 0; // lazy lines carry no marker
    childOffsets.push(region.offsets[start + j] + strip);
    childTexts.push(line.slice(strip));
    childPrefix.push(prefix[start + j] + QUOTE_PREFIX);
    const scan = ctx.scans[region.base + start + j];
    scan.prefix = childPrefix[j];
    scan.prefixStyle = "mdQuoteBorder";
  }
  const childRegion: Region = { base: region.base + start, offsets: childOffsets, texts: childTexts };
  walkBlockTokens(token.tokens, childRegion, childPrefix, ctx);
}

function styleList(token: Token, region: Region, start: number, prefix: string[], ctx: Ctx): void {
  const list = token as Tokens.List;
  let at = start;
  for (const item of list.items ?? []) {
    const segs = rawSegments(item.raw);
    if (!rawMatchesAt(segs, region.texts, at, 0)) {
      at += Math.max(segs.length, 1); // unverified item: plain, keep boundaries
      continue;
    }
    const itemStart = at;
    at = itemStart + segs.length;
    const marker = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/.exec(region.texts[itemStart]);
    const markerRawWidth = marker ? marker[0].length : 0;
    // Hanging indent width is the marker run's display width after tab
    // expansion, so the prefix is fixed-width spaces and never a tab.
    const hang = " ".repeat(tabExpanded(marker ? marker[0] : "").length);
    if (marker) emitLineSpan(region, itemStart, 0, markerRawWidth, "mdListBullet", ctx);
    const childOffsets: number[] = [];
    const childTexts: string[] = [];
    const childPrefix: string[] = [];
    for (let j = 0; j < segs.length; j++) {
      const line = region.texts[itemStart + j];
      // Continuation lines are stripped of up to the marker width of
      // leading whitespace (the item's physical indent); the marker line
      // is stripped of the marker run itself. Verification downstream
      // rejects any strip that does not match marked's view.
      const strip = j === 0 ? markerRawWidth : Math.min(/^[ \t]*/.exec(line)![0].length, markerRawWidth);
      childOffsets.push(region.offsets[itemStart + j] + strip);
      childTexts.push(line.slice(strip));
      childPrefix.push(prefix[itemStart + j] + (j === 0 ? "" : hang));
      if (j > 0) ctx.scans[region.base + itemStart + j].prefix = childPrefix[j];
    }
    const childRegion: Region = { base: region.base + itemStart, offsets: childOffsets, texts: childTexts };
    walkBlockTokens(item.tokens ?? [], childRegion, childPrefix, ctx);
  }
}

// Forward-only verbatim cursor over a paragraph's inline tokens. A token's
// spans are accepted only when its raw matches the region verbatim at the
// cursor; the cursor advances by the raw length either way (marked's token
// raws concatenate to the block text), so a mismatch drops only that span
// and later tokens continue plain without any backward search.
function walkInlineTokens(tokens: Token[], region: Region, start: number, ctx: Ctx): void {
  const cur: Cursor = { li: 0, ci: 0 };
  for (const token of tokens) {
    const raw = token.raw;
    if (raw.length === 0 || cur.li >= region.texts.length) continue;
    const segs = rawSegments(raw);
    if (rawMatchesAt(segs, region.texts, start + cur.li, cur.ci)) {
      emitInlineSpans(token, segs, region, start, cur.li, cur.ci, ctx);
    }
    advanceCursor(raw, cur);
  }
}

// Maps a raw-coordinate offset within a token's raw to (segment, column).
function mapPoint(segs: string[], offset: number): { seg: number; col: number } {
  for (let seg = 0; seg < segs.length; seg++) {
    if (offset <= segs[seg].length) return { seg, col: offset };
    offset -= segs[seg].length + 1;
  }
  return { seg: segs.length - 1, col: segs[segs.length - 1].length };
}

function emitInlineSpans(
  token: Token,
  segs: string[],
  region: Region,
  start: number,
  li: number,
  ci: number,
  ctx: Ctx,
): void {
  const emit = (from: number, to: number, style: MdSpanStyle) => {
    const p1 = mapPoint(segs, from);
    const p2 = mapPoint(segs, to);
    for (let seg = p1.seg; seg <= p2.seg; seg++) {
      const c0 = seg === p1.seg ? p1.col : 0;
      const c1 = seg === p2.seg ? p2.col : segs[seg].length;
      if (c1 <= c0) continue;
      const abs0 = (seg === 0 ? ci : 0) + c0;
      const abs1 = (seg === 0 ? ci : 0) + c1;
      emitLineSpan(region, start + li + seg, abs0, abs1, style, ctx);
    }
  };
  const raw = token.raw;
  const len = raw.length;
  switch (token.type) {
    case "strong":
    case "em":
    case "del": {
      const style: MdSpanStyle = token.type === "strong" ? "mdBold" : token.type === "em" ? "mdItalic" : "mdStrike";
      const delim = delimiterRun(raw);
      if (delim <= 0 || len < 2 * delim) return;
      emit(0, delim, "mdDim");
      emit(delim, len - delim, style);
      emit(len - delim, len, "mdDim");
      return;
    }
    case "codespan": {
      const tickMatch = /^`+/.exec(raw);
      const ticks = tickMatch ? tickMatch[0].length : 0;
      if (ticks === 0 || len < 2 * ticks || !raw.endsWith("`".repeat(ticks))) return;
      emit(0, ticks, "mdDim");
      emit(ticks, len - ticks, "mdCode");
      emit(len - ticks, len, "mdDim");
      return;
    }
    case "escape":
      if (raw.charCodeAt(0) === 92) emit(0, 1, "mdDim"); // the backslash only
      return;
    case "image":
      emit(0, len, "mdDim");
      return;
    case "link": {
      const text = (token as Tokens.Link).text;
      if (raw[0] !== "[" || raw.slice(1, 1 + text.length) !== text) return;
      const textEnd = 1 + text.length;
      const rest = raw.slice(textEnd);
      const inlineShape = rest.startsWith("](") && raw.endsWith(")") && rest.length >= 3;
      const refShape = raw === `[${text}]` || (rest.startsWith("[") && rest.endsWith("]"));
      if (!inlineShape && !refShape) return; // non-verbatim or unknown shape: plain
      if (text.length > 0) emit(1, textEnd, "mdLink");
      if (inlineShape && textEnd + 3 <= len) emit(textEnd + 2, len - 1, "mdLinkUrl");
      return;
    }
    default:
      return; // text, html, br, entities: plain
  }
}

// Length of the delimiter run repeated at both ends of strong/em/del raw.
function delimiterRun(raw: string): number {
  const ch = raw[0];
  let n = 0;
  while (n < raw.length && raw[n] === ch) n++;
  let m = 0;
  while (m < n && raw[raw.length - 1 - m] === ch) m++;
  return n === m ? n : -1;
}

// Pushes one raw-column span (clamped to the true source line length) onto
// a scan. Zero-width or fully clamped spans are dropped.
function emitLineSpan(region: Region, line: number, startCol: number, endCol: number, style: DisplayStyle, ctx: Ctx): void {
  if (line < 0 || line >= region.texts.length) return;
  const srcLine = region.base + line;
  const offset = region.offsets[line];
  const from = offset + startCol;
  const to = Math.min(offset + endCol, ctx.lines[srcLine].length);
  if (to <= from) return;
  const scan = ctx.scans[srcLine];
  (scan.spans ??= []).push({ startCol: from, endCol: to, style });
}
