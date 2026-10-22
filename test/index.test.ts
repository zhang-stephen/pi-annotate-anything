// Seam test for the /annotate argument-completion registration gate
// (spec 2026-10-20 "Host version floor and explicit failure"): both
// branches are driven through the exported annotateExtension factory with
// a stubbed pi API and a stubbed ctx.ui, so no real host session or
// notification transport is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { annotateExtension } from "../index.ts";

interface NotifyCall {
  message: string;
  level: string;
}

function stubSession() {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const commands: { name: string; options: Record<string, unknown> }[] = [];
  const notifications: NotifyCall[] = [];
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
      // session_start registers the composer editor (capturing any
      // predecessor first); the stub reports no configured predecessor.
      getEditorComponent: () => undefined,
      setEditorComponent: () => {},
    },
  } as unknown as ExtensionContext;
  return { pi, ctx, handlers, commands, notifications };
}

function fireSessionStart(session: ReturnType<typeof stubSession>) {
  const handler = session.handlers.get("session_start");
  assert.ok(handler, "session_start handler must be registered");
  handler({}, session.ctx);
}

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
