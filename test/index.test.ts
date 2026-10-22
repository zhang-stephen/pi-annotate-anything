// Seam tests for index.ts, driven through the exported annotateExtension
// factory with a stubbed pi API and a stubbed ctx.ui, so no real host
// session or notification transport is involved:
// - the /annotate argument-completion registration gate (spec 2026-10-20
//   "Host version floor and explicit failure");
// - the composer editor choreography (spec 2026-10-22 "Composer editor
//   single-install"): one registration per session_start built from the
//   first captured predecessor, no factory churn from card open/close or
//   message_start, and an idempotent session_shutdown restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";

import { annotateExtension } from "../index.ts";
import { AnnotateEditor } from "../src/tui/editor.ts";
import type { Range, VisualMode } from "../src/core/selection.ts";

// EditorFactory is not re-exported from the package root; derive it the
// same way index.ts does.
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

interface NotifyCall {
  message: string;
  level: string;
}

// The card seams these tests drive (both are private on AnnotateCard, so
// tests see them through this structural view).
interface StubCard {
  onAnnotate: (range: Range, mode: VisualMode, comment: string) => void;
  done: () => void;
  // Structural views of private fields (the jump-back tests observe the
  // open payload the way viewer.test.ts observes card state).
  file?: { path: string };
  state?: { cursor: { line: number; col: number }; scrollTop: number };
  pendingDrafts?: () => { token: string; range: Range; comment: string }[];
}

interface StubSession {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => void>;
  commands: { name: string; options: Record<string, unknown> }[];
  notifications: NotifyCall[];
  // Every setEditorComponent argument in call order (registrations and
  // restores alike; undefined only appears on a restore of "no factory").
  editorRegistrations: (EditorFactory | undefined)[];
  // Card instances built through ctx.ui.custom, in open order.
  cards: StubCard[];
  // Strings passed to pasteToEditor (the pill tokens).
  pasted: string[];
  // How often the extension read the currently configured factory. The
  // single-install semantics read it exactly once per session lifetime.
  getEditorComponentCallCount: () => number;
}

// Arguments for invoking a registered editor factory. The stub terminal
// size mirrors the host (the jump-back focus path reads it at construction).
const stubTui = { terminal: { rows: 24, columns: 80 } } as unknown as TUI;
const stubTheme = { borderColor: (s: string) => s } as EditorTheme;
const stubKeybindings = {} as KeybindingsManager;

// ANSI inverse-video wrapper, matching src/tui/editor.ts's recolor style.
const inverse = (s: string) => `\x1b[7m${s}\x1b[27m`;

// Minimal EditorComponent stand-in for a predecessor's composer: enough
// shape for withTokenRecolor and identity assertions.
function stubEditor(label: string): EditorComponent {
  return {
    render: () => [`render:${label}`],
    getText: () => label,
    setText: () => {},
    handleInput: () => {},
    invalidate: () => {},
  };
}

// Predecessor editor whose render output is read live from `line.text`, so
// a test can plant a pill token after registration.
function lineEditor(line: () => string): EditorComponent {
  return {
    render: () => [line()],
    getText: line,
    setText: () => {},
    handleInput: () => {},
    invalidate: () => {},
  };
}

function stubSession(configured?: EditorFactory) {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const commands: { name: string; options: Record<string, unknown> }[] = [];
  const notifications: NotifyCall[] = [];
  const editorRegistrations: (EditorFactory | undefined)[] = [];
  const cards: StubCard[] = [];
  const pasted: string[] = [];
  let editorText = "";
  // Host-like editor slots: setEditorComponent installs, getEditorComponent
  // reads back whatever is installed (our own wrapper after registration),
  // which is exactly the hazard the first-capture guard must avoid.
  let installedEditor: EditorFactory | undefined = configured;
  let getEditorComponentCalls = 0;
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
      handlers.set(event, handler);
      return () => {};
    },
    registerCommand: (name: string, options: Record<string, unknown>) => {
      commands.push({ name, options });
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: "/tmp/pi-annotate-seam",
    ui: {
      notify: (message: string, level?: string) => {
        notifications.push({ message, level: level ?? "info" });
      },
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
      pasteToEditor: (text: string) => {
        pasted.push(text);
      },
      // session_start registers the composer editor, capturing any
      // predecessor first; the stub defaults to no configured predecessor.
      getEditorComponent: () => {
        getEditorComponentCalls += 1;
        return installedEditor;
      },
      setEditorComponent: (factory: EditorFactory | undefined) => {
        editorRegistrations.push(factory);
        installedEditor = factory;
      },
      // Overlay lifecycle like the host: the factory runs immediately, the
      // promise settles only when the card closes via done().
      custom: (
        factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => unknown,
        _options?: unknown,
      ) =>
        new Promise<void>((resolve) => {
          const done = () => resolve();
          cards.push(factory(stubTui, stubTheme, stubKeybindings, done) as StubCard);
        }),
    },
  } as unknown as ExtensionContext;
  return {
    pi,
    ctx,
    handlers,
    commands,
    notifications,
    editorRegistrations,
    cards,
    pasted,
    getEditorComponentCallCount: () => getEditorComponentCalls,
  };
}

function fireSessionStart(session: StubSession) {
  const handler = session.handlers.get("session_start");
  assert.ok(handler, "session_start handler must be registered");
  handler({}, session.ctx);
}

function fireSessionShutdown(session: StubSession) {
  const handler = session.handlers.get("session_shutdown");
  assert.ok(handler, "session_shutdown handler must be registered");
  handler({}, session.ctx);
}

function fireMessageStart(session: StubSession) {
  const handler = session.handlers.get("message_start");
  assert.ok(handler, "message_start handler must be registered");
  handler({}, session.ctx);
}

function annotateHandler(session: StubSession): (args: string, ctx: ExtensionContext) => Promise<void> {
  const cmd = session.commands.find((c) => c.name === "annotate");
  assert.ok(cmd, "/annotate must be registered");
  return cmd!.options.handler as (args: string, ctx: ExtensionContext) => Promise<void>;
}

// Fires the /annotate handler for an existing file. The handler body runs
// synchronously up to ctx.ui.custom's await, so the card exists as soon as
// this returns; the returned promise settles only when the card closes.
function openCard(session: StubSession, filePath: string): Promise<void> {
  const running = annotateHandler(session)(filePath, session.ctx);
  assert.ok(session.cards.length === 1, "opening /annotate must construct exactly one card");
  return running;
}

// A small readable file on disk for the card flow (loadFile reads it).
// The .ts extension keeps AnnotateCard construction off the host's global
// theme singleton (highlightCode only needs it for language-less paths),
// like the .ts fixture paths in viewer.test.ts.
function writeFixture(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-annotate-editor-"));
  const path = join(dir, "notes.ts");
  writeFileSync(path, "hello world\nsecond line\n");
  return { dir, path };
}

// Completion gate ------------------------------------------------------------

test("fuzzy available: completion registered, no error notification", () => {
  const session = stubSession();
  annotateExtension(session.pi, true);
  fireSessionStart(session);
  const cmd = session.commands.find((c) => c.name === "annotate");
  assert.ok(cmd, "/annotate must be registered in the available branch");
  assert.strictEqual(typeof cmd!.options.getArgumentCompletions, "function");
  assert.deepStrictEqual(session.notifications, []);
});

test("fuzzy unavailable: explicit error naming pi >= 1.0, completion not registered", () => {
  const session = stubSession();
  annotateExtension(session.pi, false);
  fireSessionStart(session);
  const cmd = session.commands.find((c) => c.name === "annotate");
  assert.ok(cmd, "the /annotate command itself must still register");
  assert.ok(
    !("getArgumentCompletions" in cmd!.options),
    "argument completion must not be registered when the fuzzy helpers are missing",
  );
  assert.strictEqual(session.notifications.length, 1);
  assert.strictEqual(session.notifications[0].level, "error");
  assert.ok(session.notifications[0].message.includes("pi >= 1.0"), session.notifications[0].message);
});

// Composer editor choreography (spec 2026-10-22) ------------------------------

test("session_start registers one editor per call, capturing the predecessor only at the first registration", () => {
  const predecessorEditors: EditorComponent[] = [];
  // Like a real composer factory, every invocation produces a fresh editor.
  const predecessor: EditorFactory = () => {
    const editor = stubEditor("predecessor");
    predecessorEditors.push(editor);
    return editor;
  };
  const session = stubSession(predecessor);
  annotateExtension(session.pi, true);

  fireSessionStart(session);
  assert.strictEqual(session.editorRegistrations.length, 1, "session_start must register exactly one editor");

  // Reload shape: a repeated session_start re-registers, still built from
  // the FIRST capture. It must not consult getEditorComponent again: by
  // then it returns our own wrapper, and capturing it would stack recolor
  // decorators and lose the true predecessor.
  fireSessionStart(session);
  assert.strictEqual(session.editorRegistrations.length, 2, "each session_start registers exactly one editor");
  assert.strictEqual(
    session.getEditorComponentCallCount(),
    1,
    "the currently configured factory must be read only at the first registration",
  );

  // Both registrations chain the original predecessor's fresh products.
  const first = session.editorRegistrations[0]!;
  const second = session.editorRegistrations[1]!;
  assert.strictEqual(first(stubTui, stubTheme, stubKeybindings), predecessorEditors[0]);
  assert.strictEqual(second(stubTui, stubTheme, stubKeybindings), predecessorEditors[1]);
});

test("a second session_start re-registers from the first capture without double-wrapping render", async () => {
  // The predecessor's render line is mutable so the test can plant a pill
  // token after registration; recolor is then observable in the output.
  const line = { text: "no tokens yet" };
  const session = stubSession(() => lineEditor(() => line.text));
  annotateExtension(session.pi, true);
  fireSessionStart(session);
  fireSessionStart(session); // reload shape: registers again from the first capture
  assert.strictEqual(session.editorRegistrations.length, 2);

  const fixture = writeFixture();
  try {
    const running = openCard(session, fixture.path);
    const card = session.cards[0]!;
    card.onAnnotate({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 }, "char", "needs review");
    assert.strictEqual(session.pasted.length, 1, "annotating must paste the pill token");
    const token = session.pasted[0]!;
    line.text = `before ${token} after`;

    // Render through the LATEST registration: with correct first-capture
    // semantics it wraps the predecessor's editor exactly once, so the
    // token carries exactly one inverse escape pair. A registration built
    // from our own wrapper would recolor the already-recolored line and
    // nest the escapes.
    const latest = session.editorRegistrations[1]!;
    const editor = latest(stubTui, stubTheme, stubKeybindings);
    assert.strictEqual(editor.render(80)[0], `before ${inverse(token)} after`);

    card.done();
    await running;
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("the registered editor factory delegates to the previously configured factory", () => {
  const distinctiveEditors: EditorComponent[] = [];
  const predecessor: EditorFactory = () => {
    const editor = stubEditor("predecessor-composer");
    distinctiveEditors.push(editor);
    return editor;
  };
  const session = stubSession(predecessor);
  annotateExtension(session.pi, true);
  fireSessionStart(session);

  const register = session.editorRegistrations[0]!;
  const editor = register(stubTui, stubTheme, stubKeybindings);
  // Predecessor-preserving: the product is the predecessor's own editor
  // instance (withTokenRecolor decorates in place), never our fallback.
  assert.strictEqual(editor, distinctiveEditors[0]);
  assert.ok(!(editor instanceof AnnotateEditor), "a configured predecessor must not be replaced by AnnotateEditor");
  // Idle passthrough: with no pending tokens the render output is the
  // predecessor's own line, untouched.
  assert.deepStrictEqual(editor.render(80), ["render:predecessor-composer"]);
});

test("the registered editor factory falls back to AnnotateEditor when no factory was configured", () => {
  const session = stubSession(undefined);
  annotateExtension(session.pi, true);
  fireSessionStart(session);

  const register = session.editorRegistrations[0]!;
  assert.ok(register(stubTui, stubTheme, stubKeybindings) instanceof AnnotateEditor);
});

test("card open, card close without pending pills, and message_start leave the editor factory untouched", async () => {
  const fixture = writeFixture();
  try {
    const session = stubSession();
    annotateExtension(session.pi, true);
    fireSessionStart(session);
    assert.strictEqual(session.editorRegistrations.length, 1);

    const running = openCard(session, fixture.path);
    assert.strictEqual(
      session.editorRegistrations.length,
      1,
      "opening the annotation card must not register or restore the editor",
    );

    session.cards[0]!.done(); // close without ever creating a draft
    await running;
    assert.strictEqual(
      session.editorRegistrations.length,
      1,
      "closing the card without pending pills must not restore the editor",
    );

    fireMessageStart(session);
    assert.strictEqual(session.editorRegistrations.length, 1, "message_start must not touch the editor factory");
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("card close with pending pills leaves the editor factory untouched", async () => {
  const fixture = writeFixture();
  try {
    const session = stubSession();
    annotateExtension(session.pi, true);
    fireSessionStart(session);
    assert.strictEqual(session.editorRegistrations.length, 1);

    const running = openCard(session, fixture.path);
    const card = session.cards[0]!;
    card.onAnnotate({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 }, "char", "needs review");
    assert.strictEqual(session.pasted.length, 1, "the pending pill must be pasted before close");

    card.done(); // close with a pill still pending: no idle restore anymore
    await running;
    assert.strictEqual(
      session.editorRegistrations.length,
      1,
      "closing with pending pills must keep the editor installed",
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("session_shutdown restores the captured predecessor factory and tolerates a second call", () => {
  const predecessor: EditorFactory = () => stubEditor("predecessor");
  const session = stubSession(predecessor);
  annotateExtension(session.pi, true);
  fireSessionStart(session);
  assert.strictEqual(session.editorRegistrations.length, 1);

  fireSessionShutdown(session);
  assert.strictEqual(session.editorRegistrations.length, 2);
  assert.strictEqual(
    session.editorRegistrations[1],
    predecessor,
    "shutdown must restore the factory captured at registration time",
  );

  const afterRestore = session.editorRegistrations.length;
  fireSessionShutdown(session); // double shutdown: idempotent
  assert.strictEqual(
    session.editorRegistrations.length,
    afterRestore,
    "a repeated shutdown must not restore (or register) again",
  );
});

// alt+o jump-back (spec 2026-10-23 "Composer Jump Back") ----------------------

// Second and later card opens (openCard asserts on a fresh session only).
function openNewCard(session: StubSession, filePath: string): Promise<void> {
  const before = session.cards.length;
  const running = annotateHandler(session)(filePath, session.ctx);
  assert.ok(session.cards.length === before + 1, "the handler must construct exactly one new card");
  return running;
}

function registeredEditor(session: StubSession): EditorComponent {
  const register = session.editorRegistrations[0]!;
  return register(stubTui, stubTheme, stubKeybindings);
}

test("alt+o opens the viewer via the /annotate path on the LAST token's range", async () => {
  const fixture = writeFixture();
  try {
    const line = { text: "" };
    const session = stubSession(() => lineEditor(() => line.text));
    annotateExtension(session.pi, true);
    fireSessionStart(session);

    // Two drafts in the same file through the real /annotate flow; the
    // first pill stays "in the composer" (both the stub editor text and the
    // host editor text) so the reconcile prune keeps its draft alive, like
    // a real composer holding both pills.
    const running1 = openCard(session, fixture.path);
    session.cards[0]!.onAnnotate({ startLine: 0, startCol: 6, endLine: 0, endCol: 11 }, "char", "first");
    const token1 = session.pasted[0]!;
    session.cards[0]!.done();
    await running1;

    line.text = token1;
    session.ctx.ui.setEditorText(line.text);
    const running2 = openNewCard(session, fixture.path);
    session.cards[1]!.onAnnotate({ startLine: 1, startCol: 0, endLine: 1, endCol: 6 }, "char", "second");
    const token2 = session.pasted[1]!;
    session.cards[1]!.done();
    await running2;

    line.text = `keep ${token1} then recheck ${token2} end`;
    session.ctx.ui.setEditorText(line.text);

    const before = session.cards.length;
    registeredEditor(session).handleInput("\x1bo");
    assert.equal(session.cards.length, before + 1, "alt+o must open the viewer");

    const card = session.cards[before]!;
    assert.equal(card.file!.path, fixture.path, "the open payload carries the token's file");
    assert.deepEqual(
      card.state!.cursor,
      { line: 1, col: 0 },
      "the cursor lands at the LAST draft's range start",
    );
    assert.deepEqual(
      card.pendingDrafts!().map((d) => d.token),
      [token1, token2],
      "the store-driven pending replay carries every live draft of the file",
    );
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("alt+o clamps fail-open when the annotated file shortened on disk", async () => {
  const fixture = writeFixture();
  try {
    const line = { text: "" };
    const session = stubSession(() => lineEditor(() => line.text));
    annotateExtension(session.pi, true);
    fireSessionStart(session);

    const running = openCard(session, fixture.path);
    session.cards[0]!.onAnnotate({ startLine: 1, startCol: 7, endLine: 1, endCol: 12 }, "char", "gone soon");
    const token = session.pasted[0]!;
    session.cards[0]!.done();
    await running;

    // The file shrinks to one short line after the pill was made.
    writeFileSync(fixture.path, "tiny\n");
    line.text = token;
    session.ctx.ui.setEditorText(line.text);

    const before = session.cards.length;
    registeredEditor(session).handleInput("\x1bo");
    const card = session.cards[before]!;
    assert.deepEqual(
      card.state!.cursor,
      // clampPosition pins the line to EOF and the col to the LANDED line's
      // length ("tiny" is 4 wide): the nearest live position, not an error.
      { line: 0, col: 4 },
      "cursor clamps to the truncated file's EOF",
    );
    assert.equal(card.state!.scrollTop, 0);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("alt+o with no pill in the buffer warns and is swallowed (the inner editor never sees it)", () => {
  const received: string[] = [];
  const session = stubSession(() => ({
    render: () => ["composer"],
    getText: () => "",
    setText: () => {},
    handleInput: (data: string) => {
      received.push(data);
    },
    invalidate: () => {},
  }));
  annotateExtension(session.pi, true);
  fireSessionStart(session);

  const before = session.cards.length;
  registeredEditor(session).handleInput("\x1bo");
  assert.deepEqual(received, [], "the swallowed alt+o never reaches the inner editor");
  assert.equal(session.cards.length, before, "no viewer opens without a live token");
  const warnings = session.notifications.filter((n) => n.level === "warning");
  assert.equal(warnings.length, 1, "exactly one warning notifies the miss");
  assert.equal(warnings[0]!.message, "alt+o: no annotation pills in the composer");

  // The swallow is scoped to the no-token alt+o miss: other keys still
  // reach the inner editor unchanged.
  registeredEditor(session).handleInput("x");
  assert.deepEqual(received, ["x"], "non-alt+o keys forward unchanged");
});

test("alt+o on a pill whose file vanished notifies instead of opening the viewer", async () => {
  const fixture = writeFixture();
  const line = { text: "" };
  const session = stubSession(() => lineEditor(() => line.text));
  annotateExtension(session.pi, true);
  fireSessionStart(session);

  const running = openCard(session, fixture.path);
  session.cards[0]!.onAnnotate({ startLine: 0, startCol: 0, endLine: 0, endCol: 5 }, "char", "doomed");
  const token = session.pasted[0]!;
  session.cards[0]!.done();
  await running;

  rmSync(fixture.dir, { recursive: true, force: true });
  line.text = token;
  session.ctx.ui.setEditorText(line.text);

  const before = session.cards.length;
  registeredEditor(session).handleInput("\x1bo");
  assert.equal(session.cards.length, before, "a vanished file opens no viewer");
  const errors = session.notifications.filter((n) => n.level === "error");
  assert.equal(errors.length, 1);
  assert.ok(errors[0]!.message.includes("not-found"), errors[0]!.message);
});
