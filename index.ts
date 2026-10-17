// Extension entry point: wires the annotate flow together.
//
// - session_start creates the draft store and installs AnnotateEditor as the
//   composer (pill recoloring); session_shutdown restores the default editor.
// - /annotate <path> opens AnnotateCard in an overlay; annotations land in
//   the store and their token pill is pasted into the composer.
// - The "input" event expands tokens into full payload blocks. Pi clears the
//   composer synchronously BEFORE onSubmit, so at input-event time
//   getEditorText() is already empty: pruning for interactive input runs
//   against the submitted text (which still contains the pills), while
//   RPC/extension input leaves the composer untouched and prunes against the
//   live editor text.
// - "message_start" prunes against the current editor text: after the user's
//   own send the composer is empty, so drafts are retired; pills still
//   present (unrelated messages) keep their drafts. Never blind-clear.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AnnotateEditor } from "./src/editor.ts";
import { extractRange, loadFile, resolvePath } from "./src/file-range.ts";
import { tokenLabel } from "./src/message.ts";
import { AnnotationStore } from "./src/store.ts";
import { expandTokens } from "./src/transform.ts";
import { AnnotateCard } from "./src/viewer.ts";

export default function (pi: ExtensionAPI) {
  // Assigned by session_start, which always runs before commands and events
  // can reach the handlers below.
  let store: AnnotationStore;

  pi.on("session_start", (_event, ctx) => {
    store = new AnnotationStore();
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new AnnotateEditor(tui, theme, keybindings, () => store.list().map((d) => d.token)),
    );
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setEditorComponent(undefined);
  });

  pi.registerCommand("annotate", {
    description: "Annotate a range of a file: /annotate <path>",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (!arg) {
        ctx.ui.notify("Usage: /annotate <path>", "error");
        return;
      }
      const filePath = resolvePath(arg, ctx.cwd);
      const loaded = loadFile(filePath);
      if (!loaded.ok) {
        ctx.ui.notify(`annotate: ${loaded.reason}: ${filePath}`, "error");
        return;
      }
      // Reconcile before building the card: pending markers must only show
      // ranges whose pills are still in the composer. The card keeps a live
      // getter, re-read on every render, so annotations created while the
      // card stays open show their marker immediately.
      store.pruneFromText(ctx.ui.getEditorText());
      const pending = () => store.list().filter((d) => d.absPath === loaded.path).map((d) => d.range);
      await ctx.ui.custom<void>(
        (tui, _theme, _keybindings, done) =>
          new AnnotateCard(
            tui,
            { path: loaded.path, lines: loaded.lines },
            pending,
            (range, mode, comment) => {
              const snapshot = extractRange(loaded.lines, range);
              const draft = store.add(
                { absPath: loaded.path, range, mode, snapshot, comment },
                tokenLabel(loaded.path, ctx.cwd, range, mode),
              );
              ctx.ui.pasteToEditor(draft.token);
              ctx.ui.notify(`Annotation added: ${draft.token}`);
            },
            // AnnotateCard closes without a result; done's T is fixed to void.
            () => done(),
          ),
        { overlay: true, overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" } },
      );
    },
  });

  pi.on("input", (event, ctx) => {
    // Pi clears the composer synchronously before onSubmit, so the editor is
    // already empty here. Interactive input still has the pills in
    // event.text; other sources leave the composer intact.
    const basis = event.source === "interactive" ? event.text : ctx.ui.getEditorText();
    store.pruneFromText(basis);
    const result = expandTokens(event.text, store, ctx.cwd);
    if (!result.changed) return { action: "continue" };
    return { action: "transform", text: result.text };
  });

  pi.on("message_start", (_event, ctx) => {
    store.pruneFromText(ctx.ui.getEditorText());
  });
}
