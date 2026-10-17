import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

/**
 * Wrap every exact occurrence of every token in `line` with `style`.
 *
 * Tokens are plain text (no ANSI), so matching operates on raw substrings of
 * the rendered line. Replacement is done in a single pass with a combined
 * pattern, longest token first, so that:
 * - a token that is a prefix of a longer token never shadows it, and
 * - tokens are never re-matched inside already-styled output, which keeps
 *   `visibleWidth` unchanged for zero-width styles (e.g. ANSI escapes).
 */
export function recolorTokens(line: string, tokens: string[], style: (s: string) => string): string {
  const present = [...new Set(tokens.filter((token) => token.length > 0 && line.includes(token)))];
  if (present.length === 0) return line;
  const sorted = present.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sorted.map(escapeRegExp).join("|"), "g");
  return line.replace(pattern, (match) => style(match));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Composer editor that renders pill tokens in inverse video.
 *
 * Color-only replacement over the lines produced by the base editor. Known
 * limitation (accepted for the MVP): a token split across wrapped lines is
 * not recolored and stays plain text.
 */
export class AnnotateEditor extends CustomEditor {
  private readonly getTokens: () => string[];

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, getTokens: () => string[]) {
    super(tui, theme, keybindings);
    this.getTokens = getTokens;
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    const tokens = this.getTokens();
    if (tokens.length === 0) return lines;
    return lines.map((line) => recolorTokens(line, tokens, (s) => `\x1b[7m${s}\x1b[27m`));
  }
}
