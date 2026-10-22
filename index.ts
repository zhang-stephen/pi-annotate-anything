// Extension entry point: wires the annotate flow together.
//
// - The composer editor is registered exactly once per session in
//   session_start: the previously configured editor factory (e.g. another
//   extension's custom composer) is captured and decorated with pill
//   recoloring, falling back to AnnotateEditor when nothing was configured.
//   The editor instance is never swapped again: the host copies text and
//   appearance across editor swaps but not prompt history, so swapping per
//   annotation cycle would split the composer's history. session_shutdown
//   restores the captured factory.
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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { AnnotateEditor, withTokenRecolor } from "./src/tui/editor.ts";
import { extractRange, loadFile, resolvePath } from "./src/core/file-range.ts";
import { tokenLabel } from "./src/core/message.ts";
import { completePath, fuzzyAvailable } from "./src/tui/path-completion.ts";
import { AnnotationStore } from "./src/core/store.ts";
import { expandTokens } from "./src/core/transform.ts";
import { AnnotateCard } from "./src/viewer/viewer.ts";

export default function (pi: ExtensionAPI) {
  annotateExtension(pi, fuzzyAvailable);
}

// Test seam: the fuzzy availability flag is injected so both registration
// branches (completion registered vs. explicit-failure gate) are drivable
// with stubbed pi/ctx; production always passes the runtime probe result
// from path-completion.ts.
export function annotateExtension(pi: ExtensionAPI, fuzzy: boolean): void {
  // The composer editor is registered once per session in session_start and
  // is PREDECESSOR-PRESERVING: the wrapper decorates whatever editor the
  // captured predecessor factory (e.g. zentui's) produces instead of
  // replacing it, so other extensions' composer styling keeps working
  // underneath the pill recoloring. The wrapper is stateless: the token
  // list is read live from the store, and with no pending tokens recolor is
  // a pure passthrough, so the registration never needs to change again.
  let store: AnnotationStore;
  // The completion callback receives no ctx, so it cannot read ctx.cwd
  // directly; session_start keeps this in sync with the session cwd, which
  // differs from the process cwd when a stored session is resumed from
  // another directory (the handler resolves against ctx.cwd).
  let sessionCwd = process.cwd();
  // EditorFactory is not re-exported from the package root; derive it.
  type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

  // Captured at the FIRST editor registration (see session_start): the
  // factory configured before ours, or undefined when nothing was
  // configured. A repeated session_start (/reload shape) rebuilds the
  // wrapper from this first capture instead of from getEditorComponent(),
  // which by then returns our own wrapper; wrapping that again would stack
  // recolor decorators and lose the true predecessor.
  let savedFactory: EditorFactory | undefined;
  // True from the first session_start registration until session_shutdown.
  let editorRegistered = false;

  const getTokens = () => store.list().map((d) => d.token);

  pi.on("session_start", (_event, ctx) => {
    store = new AnnotationStore();
    sessionCwd = ctx.cwd;
    // Register the pill-recoloring editor once per session, before the
    // first user input: capture the predecessor factory only at this first
    // registration and register the same wrapper body every time, so a
    // repeated session_start (/reload shape) re-registers the same wrapper
    // instead of wrapping our own already-registered factory.
    if (!editorRegistered) {
      savedFactory = ctx.ui.getEditorComponent();
      editorRegistered = true;
    }
    const predecessor = savedFactory;
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      predecessor
        ? withTokenRecolor(predecessor(tui, theme, keybindings), getTokens)
        : new AnnotateEditor(tui, theme, keybindings, getTokens),
    );
    // Explicit-failure gate (spec 2026-10-20 "Host version floor and
    // explicit failure"): without the fuzzy helpers the user gets the
    // reason and the version floor, never a silent prefix-matching
    // fallback -- the completion registration below is omitted entirely.
    if (!fuzzy) {
      ctx.ui.notify(
        "Fuzzy path completion requires pi >= 1.0; /annotate argument completion is disabled.",
        "error",
      );
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    // Restore the factory configured before ours. Idempotent: a repeated
    // shutdown finds editorRegistered false and leaves the editor alone.
    if (!editorRegistered) return;
    ctx.ui.setEditorComponent(savedFactory);
    editorRegistered = false;
  });

  pi.registerCommand("annotate", {
    description: "Annotate a range of a file: /annotate <path>",
    // The fuzzy completion feature is registered only when the host pi-tui
    // exports the fuzzy helpers (link-safe probe in path-completion.ts);
    // otherwise the property is omitted entirely. Completion callbacks
    // receive only the argument prefix (no ctx); the session cwd tracked
    // above keeps relative paths consistent with the handler's
    // resolvePath(arg, ctx.cwd).
    ...(fuzzy
      ? { getArgumentCompletions: (argumentPrefix: string) => completePath(argumentPrefix, sessionCwd) }
      : {}),
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
      // Live getters, re-read on every render: pending drives the gutter/
      // underline markers; pendingDrafts carries token/range/comment for the
      // card's edit (c) and delete (x) targeting. Both list this file's
      // drafts oldest first, so overlapping ranges resolve to the most
      // recently added one.
      const pendingDrafts = () =>
        store
          .list()
          .filter((d) => d.absPath === loaded.path)
          // range objects are shared by reference (never copied); the
          // viewer's emphasis map keys on their identity, so keep it that way.
          .map((d) => ({ token: d.token, range: d.range, comment: d.comment }));
      const pending = () => pendingDrafts().map((d) => d.range);
      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
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
            (draftId, comment) => {
              // Edit submit: update the draft in place. The token is
              // unchanged, so the pill already in the composer stays valid:
              // no new pill is pasted.
              store.updateComment(draftId, comment);
              ctx.ui.notify(`Comment updated: ${draftId}`);
            },
            (draftId) => {
              // Delete: drop the draft and strip its pill (first occurrence)
              // from the composer. Pill already deleted by the user: remove
              // the draft silently (the card render is the feedback).
              // store.remove (not prune: prune KEEPS only the listed tokens).
              store.remove(draftId);
              const text = ctx.ui.getEditorText();
              if (!text.includes(draftId)) return;
              ctx.ui.setEditorText(text.replace(draftId, ""));
              ctx.ui.notify(`Annotation deleted: ${draftId}`);
            },
            pendingDrafts,
            // Chrome colors and the title's relative path come from the
            // factory's active theme and the command's cwd.
            theme,
            ctx.cwd,
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
