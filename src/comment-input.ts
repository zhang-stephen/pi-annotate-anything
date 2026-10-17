// Pure comment-input state machine and renderer for the annotation card.
// No pi imports: the box is plain ANSI-styled strings and the caller supplies
// the styling function (theme), so this module stays testable without a TUI.
// The viewer state machine (viewer-state.ts) imports reduceComment and the
// CommentState/CommentKey types from here.

export interface CommentState {
  text: string;
}

export type CommentKey =
  | { kind: "char"; ch: string }
  | { kind: "newline" } // ctrl+j / shift+enter
  | { kind: "backspace" }
  | { kind: "submit" } // Enter
  | { kind: "cancel" }; // Esc

export type CommentEffect = { type: "submit"; text: string } | { type: "cancel" };

export interface CommentResult {
  state: CommentState;
  effect?: CommentEffect;
}

export function reduceComment(state: CommentState, key: CommentKey): CommentResult {
  switch (key.kind) {
    case "char":
      return { state: { text: state.text + key.ch } };
    case "newline":
      return { state: { text: state.text + "\n" } };
    case "backspace":
      if (state.text.length === 0) return { state };
      return { state: { text: state.text.slice(0, -1) } };
    case "submit":
      // State is left unchanged on purpose: the effect carries the text and
      // the card owner decides whether to reset or close the editor.
      return { state, effect: { type: "submit", text: state.text } };
    case "cancel":
      return { state, effect: { type: "cancel" } };
  }
}

// Renders the embedded comment box: styled top border, "Comment:" prompt
// line, one raw line per source line, styled bottom border. Text lines are
// never truncated (the caller owns clipping/scrolling); padding guards keep
// degenerate widths from crashing.
export function renderCommentBox(
  state: CommentState,
  width: number,
  theme: (s: string) => string,
): string[] {
  const inner = Math.max(0, width - 2);
  const border = "+" + "-".repeat(inner) + "+";
  const label = "Comment:";
  const pad = (visibleLength: number) => " ".repeat(Math.max(0, inner - 1 - visibleLength));
  const prompt = "| " + theme(label) + pad(label.length) + "|";
  const rows = state.text.split("\n").map((line) => "| " + line + pad(line.length) + "|");
  return [theme(border), prompt, ...rows, theme(border)];
}
