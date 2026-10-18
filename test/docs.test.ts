// Validates the SDD document discipline declared in docs/superpowers/AGENTS.md:
// front-matter schema, spec <-> plan links, and STATUS.md index consistency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/superpowers");
const STATUSES = new Set(["draft", "approved", "in-progress", "done", "superseded"]);

interface Doc {
  path: string; // absolute
  kind: "spec" | "plan";
  fm: Record<string, string | string[]>;
  h1: string;
}

// Minimal front-matter parser: flat `key: value` scalars plus block sequences
// (`key:` followed by `- item` lines). No YAML dependency on purpose.
export function parseFrontMatter(text: string): Record<string, string | string[]> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm: Record<string, string | string[]> = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([a-z-]+):\s*(.*)$/);
    if (!kv) continue;
    if (kv[2] === "") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+- \S/.test(lines[i + 1])) {
        items.push(lines[++i].replace(/^\s+- /, "").trim());
      }
      fm[kv[1]] = items.length ? items : "";
    } else {
      fm[kv[1]] = kv[2].trim();
    }
  }
  return fm;
}

function asList(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDoc(path: string, kind: "spec" | "plan"): Doc {
  const text = readFileSync(path, "utf8");
  const fm = parseFrontMatter(text);
  assert.ok(Object.keys(fm).length > 0, `${path}: missing YAML front-matter`);
  const h1 = (text.match(/^# (.+)$/m) ?? [])[1];
  return { path, kind, fm, h1 };
}

function listDocs(): Doc[] {
  const docs: Doc[] = [];
  for (const kind of ["spec", "plan"] as const) {
    const dir = join(DOCS_DIR, kind + "s");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      docs.push(parseDoc(join(dir, f), kind));
    }
  }
  return docs;
}

const docs = listDocs();

test("every spec/plan has title (matching its H1) and a valid status", () => {
  for (const d of docs) {
    assert.ok(typeof d.fm.title === "string" && d.fm.title, `${d.path}: missing title`);
    assert.equal(d.fm.title, d.h1, `${d.path}: title must equal the document's H1`);
    assert.ok(typeof d.fm.status === "string", `${d.path}: missing status`);
    assert.ok(STATUSES.has(d.fm.status as string), `${d.path}: invalid status ${d.fm.status}`);
    assert.equal(d.fm.created, undefined, `${d.path}: no created field (filename carries the date)`);
    assert.equal(d.fm.updated, undefined, `${d.path}: no updated field (git carries the history)`);
  }
});

test("parseFrontMatter supports scalar and block-sequence values", () => {
  const fm = parseFrontMatter("---\ntitle: T\nplan:\n  - ../plans/a.md\n  - ../plans/b.md\n---\n# T\n");
  assert.equal(fm.title, "T");
  assert.deepEqual(fm.plan, ["../plans/a.md", "../plans/b.md"]);
  assert.deepEqual(parseFrontMatter("no front-matter"), {});
});

test("plans carry progress and a spec link; specs link back", () => {
  for (const d of docs) {
    if (d.kind === "plan") {
      assert.ok(typeof d.fm.progress === "string" && /^\d+\/\d+$/.test(d.fm.progress), `${d.path}: progress must be n/m`);
      assert.ok(typeof d.fm.spec === "string" && d.fm.spec, `${d.path}: missing spec field (use 'spec: none' for plan-only work)`);
      const specLink = d.fm.spec as string;
      if (specLink === "none") continue;
      const specPath = resolve(dirname(d.path), specLink);
      assert.ok(existsSync(specPath), `${d.path}: spec link does not resolve: ${specLink}`);
      const spec = docs.find((s) => s.path === specPath);
      assert.ok(spec, `${d.path}: spec link must point into docs/superpowers/specs/`);
      const backLinks = asList(spec.fm.plan).map((p) => resolve(dirname(spec.path), p));
      assert.ok(backLinks.includes(d.path), `${d.path}: spec must list this plan in its plan field`);
    } else {
      for (const planLink of asList(d.fm.plan)) {
        const planPath = resolve(dirname(d.path), planLink);
        assert.ok(existsSync(planPath), `${d.path}: plan link does not resolve: ${planLink}`);
        const plan = docs.find((p) => p.path === planPath);
        assert.ok(plan, `${d.path}: plan link must point into docs/superpowers/plans/`);
        assert.ok(typeof plan.fm.spec === "string" && resolve(dirname(plan.path), plan.fm.spec) === d.path, `${d.path}: plan must link back via its spec field`);
      }
      if (d.fm.status === "done") assert.ok(asList(d.fm.plan).length > 0, `${d.path}: a done spec must link its plan`);
    }
    if (d.fm.status === "superseded") {
      assert.ok(typeof d.fm["superseded-by"] === "string" && d.fm["superseded-by"], `${d.path}: superseded requires superseded-by`);
      assert.ok(existsSync(resolve(dirname(d.path), d.fm["superseded-by"] as string)), `${d.path}: superseded-by does not resolve`);
    }
  }
});

test("STATUS.md indexes every doc exactly once, in the section matching its status", () => {
  const status = readFileSync(join(DOCS_DIR, "STATUS.md"), "utf8");
  const sections: Record<string, string> = {};
  let current = "";
  for (const line of status.split("\n")) {
    const h = line.match(/^## (.+)/);
    if (h) current = h[1].trim();
    else if (current) sections[current] = (sections[current] ?? "") + line + "\n";
  }
  for (const d of docs) {
    const rel = "docs/superpowers/" + d.kind + "s/" + d.path.split("/").pop();
    const inActive = (sections["Active"] ?? "").includes(rel);
    const inDone = (sections["Done"] ?? "").includes(rel);
    assert.ok(inActive !== inDone, `${rel}: must appear in exactly one of STATUS.md's Active/Done sections`);
    if (d.fm.status === "done") assert.ok(inDone, `${rel}: status is done but not under Done`);
    else assert.ok(inActive, `${rel}: status is ${d.fm.status} but not under Active`);
  }
});
