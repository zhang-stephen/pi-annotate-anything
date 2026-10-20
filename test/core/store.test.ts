import { test } from "node:test";
import assert from "node:assert/strict";

import type { Range } from "../../src/core/selection.ts";
import { AnnotationStore, type Draft } from "../../src/core/store.ts";

const rangeA: Range = { startLine: 9, startCol: 0, endLine: 19, endCol: 5 };
const rangeB: Range = { startLine: 0, startCol: 1, endLine: 2, endCol: 3 };

function draft(absPath: string, range: Range, snapshot: string, comment: string): Omit<Draft, "token"> {
  return { absPath, range, mode: "line", snapshot, comment };
}

test("add: returns the base token when it is free", () => {
  const store = new AnnotationStore();
  const d = store.add(draft("/a.ts", rangeA, "snap", "note"), "[a.ts:10-20]");
  assert.equal(d.token, "[a.ts:10-20]");
});

test("add: returns a unique token for every draft", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "snap", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/a.ts", rangeB, "snap", "two"), "[a.ts:1-3]").token;
  assert.notEqual(t1, t2);
  const t3 = store.add(draft("/a.ts", rangeA, "snap", "three"), "[a.ts:10-20]").token;
  assert.notEqual(t1, t3);
  assert.notEqual(t2, t3);
});

test("add: identical base annotated twice gets a ~2 suffix, third gets ~3", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "snap", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/a.ts", rangeA, "snap", "two"), "[a.ts:10-20]").token;
  const t3 = store.add(draft("/a.ts", rangeA, "snap", "three"), "[a.ts:10-20]").token;
  assert.equal(t1, "[a.ts:10-20]");
  assert.equal(t2, "[a.ts:10-20 ~2]");
  assert.equal(t3, "[a.ts:10-20 ~3]");
});

test("add: suffix numbering reuses freed slots without colliding with live drafts", () => {
  const store = new AnnotationStore();
  store.add(draft("/a.ts", rangeA, "snap", "one"), "[a.ts:10-20]");
  const t2 = store.add(draft("/a.ts", rangeA, "snap", "two"), "[a.ts:10-20]").token;
  const t3 = store.add(draft("/a.ts", rangeA, "snap", "three"), "[a.ts:10-20]").token;
  store.prune([t2, t3]); // base slot freed, ~2 and ~3 stay live
  const t4 = store.add(draft("/a.ts", rangeA, "snap", "four"), "[a.ts:10-20]").token;
  const live = store.list().map((d) => d.token);
  assert.equal(new Set(live).size, live.length, "live tokens must stay unique");
  assert.deepEqual(live, [t2, t3, t4]);
  assert.equal(t4, "[a.ts:10-20]"); // freed base slot is reused, not re-suffixed
});

test("list: returns drafts in insertion order", () => {
  const store = new AnnotationStore();
  store.add(draft("/a.ts", rangeA, "s1", "first"), "[a.ts:10-20]");
  store.add(draft("/b.ts", rangeB, "s2", "second"), "[b.ts:1-3]");
  store.add(draft("/c.ts", rangeA, "s3", "third"), "[c.ts:10-20]");
  assert.deepEqual(
    store.list().map((d) => d.absPath),
    ["/a.ts", "/b.ts", "/c.ts"],
  );
});

test("get: exact-match lookup only", () => {
  const store = new AnnotationStore();
  const d = store.add(draft("/a.ts", rangeA, "snap", "note"), "[a.ts:10-20]");
  assert.equal(store.get("[a.ts:10-20]"), d);
  assert.equal(store.get("[a.ts:10-20"), undefined);
  assert.equal(store.get("[a.ts:10-20] "), undefined);
  assert.equal(store.get("[a.ts:10-2]"), undefined);
});

test("get: finds suffixed drafts by their exact token", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "snap", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/a.ts", rangeA, "snap", "two"), "[a.ts:10-20]").token;
  assert.equal(t2, "[a.ts:10-20 ~2]");
  assert.equal(store.get("[a.ts:10-20 ~3]"), undefined);
  assert.equal(store.get(t1)?.comment, "one");
  assert.equal(store.get(t2)?.comment, "two");
});

test("prune: drops entries whose token is gone, keeps the rest", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "s1", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/b.ts", rangeB, "s2", "two"), "[b.ts:1-3]").token;
  store.add(draft("/c.ts", rangeA, "s3", "three"), "[c.ts:10-20]");
  store.prune([t1, t2]);
  assert.deepEqual(
    store.list().map((d) => d.comment),
    ["one", "two"],
  );
});

test("prune: accepts tokens that are not in the store", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "s1", "one"), "[a.ts:10-20]").token;
  store.prune([t1, "[never-existed.ts:1-2]"]);
  assert.equal(store.list().length, 1);
});

test("pruneFromText: keeps only drafts whose token appears as a substring of the text", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "s1", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/b.ts", rangeB, "s2", "two"), "[b.ts:1-3]").token;
  const t3 = store.add(draft("/c.ts", rangeA, "s3", "three"), "[c.ts:10-20]").token;
  const text = [
    "before [a.ts:10-20] after",
    "[b.ts:1-3] at line start",
    "truncated [b.ts:1- should not match",
    "[c.ts:10-20 ~2] would be a different token",
  ].join("\n");
  store.pruneFromText(text);
  assert.deepEqual(store.list().map((d) => d.token), [t1, t2]);
});

test("pruneFromText: a suffixed token is not kept by its base appearing alone", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "snap", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/a.ts", rangeA, "snap", "two"), "[a.ts:10-20]").token;
  assert.notEqual(t1, t2);
  store.pruneFromText("only [a.ts:10-20] here");
  assert.deepEqual(store.list().map((d) => d.token), [t1]);
  assert.equal(store.get(t2), undefined);
  // Re-annotating the same base reuses the now-free ~2 slot, no collision.
  const t3 = store.add(draft("/a.ts", rangeA, "snap", "again"), "[a.ts:10-20]").token;
  assert.equal(t3, "[a.ts:10-20 ~2]");
  store.pruneFromText(`text [a.ts:10-20] and ${t3}`);
  assert.deepEqual(store.list().map((d) => d.token), [t1, t3]);
});

test("updateComment: replaces only the comment; token, range, snapshot and mode untouched", () => {
  const store = new AnnotationStore();
  const d = store.add(draft("/a.ts", rangeA, "snap", "old"), "[a.ts:10-20]");
  store.updateComment(d.token, "new");
  const updated = store.get(d.token) as Draft;
  assert.equal(updated.comment, "new");
  assert.equal(updated.token, d.token);
  assert.equal(updated.snapshot, "snap");
  assert.equal(updated.absPath, "/a.ts");
  assert.deepEqual(updated.range, rangeA);
  assert.equal(updated.mode, "line");
});

test("updateComment: unknown id is a no-op", () => {
  const store = new AnnotationStore();
  const d = store.add(draft("/a.ts", rangeA, "snap", "old"), "[a.ts:10-20]");
  store.updateComment("[missing.ts:1-2]", "new");
  assert.equal(store.get(d.token)?.comment, "old");
  assert.equal(store.get("[missing.ts:1-2]"), undefined);
  assert.equal(store.list().length, 1);
});

test("updateComment: keeps the updated draft's position in list() order", () => {
  const store = new AnnotationStore();
  const t1 = store.add(draft("/a.ts", rangeA, "s1", "one"), "[a.ts:10-20]").token;
  const t2 = store.add(draft("/b.ts", rangeB, "s2", "two"), "[b.ts:1-3]").token;
  store.updateComment(t1, "edited");
  assert.deepEqual(store.list().map((d) => d.token), [t1, t2]);
});

test("clear: empties the store", () => {
  const store = new AnnotationStore();
  store.add(draft("/a.ts", rangeA, "s1", "one"), "[a.ts:10-20]");
  store.add(draft("/b.ts", rangeB, "s2", "two"), "[b.ts:1-3]");
  store.clear();
  assert.deepEqual(store.list(), []);
  assert.equal(store.get("[a.ts:10-20]"), undefined);
});

test("store.remove deletes only the targeted draft", () => {
  const store = new AnnotationStore();
  const a = store.add(draft("/f.ts", rangeA, "snap", "one"), "[f.ts:1-2]");
  const b = store.add(draft("/f.ts", rangeB, "snap", "two"), "[f.ts:3-4]");
  store.remove(a.token);
  assert.deepEqual(store.list().map((d) => d.token), [b.token]);
  // Unknown token is a no-op.
  store.remove("[f.ts:99-100]");
  assert.equal(store.list().length, 1);
});
