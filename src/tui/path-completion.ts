// Filesystem path completion for the /annotate argument. Pure logic, no UI:
// given the typed prefix and a cwd, return candidate AutocompleteItems, or
// null when the target directory cannot be read (the caller decides what to
// show in that case, e.g. fall back to no completions).
//
// Scope rules (spec 2026-10-20 "Query scope rules", rule 2 amended
// 2026-10-20), split at the last "/":
// 1. Empty query: unchanged directory browsing of cwd (directories first,
//    then case-insensitive by name).
// 2. Query with a slash: dirPart resolved verbatim; an empty remainder
//    lists that directory's immediate entries (browsing equivalent);
//    otherwise the remainder fuzzy-matches the workspace index subtree
//    under dirPart (recursive, e.g. "src/vsta" reaches
//    "src/viewer/state.ts"), ordered by fuzzy score with enumeration
//    order as tiebreak and capped at MAX_ITEMS. While the index is
//    building/oversized/failed, or dirPart resolves outside the workspace
//    root, this degrades to the pre-amendment non-recursive
//    single-directory fuzzy listing.
// 3. No slash, non-empty: fuzzyFilter over the workspace file index
//    (src/core/file-index.ts); while the index is building/oversized/failed
//    this falls back to rule 1 browsing for the duration.

import fs from "node:fs";
import path from "node:path";

// Namespace import on purpose: probing tui.fuzzyFilter/tui.fuzzyMatch is
// the link-safe feature detect below. A bare named import of a missing
// export can fail at ESM link time and crash module load before the
// registration gate in index.ts ever runs, while a namespace import only
// yields undefined properties on hosts whose pi-tui predates the helpers.
import * as tui from "@earendil-works/pi-tui";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { createFileIndex } from "../core/file-index.ts";
import type { FileIndex } from "../core/file-index.ts";
import { resolvePath } from "../core/file-range.ts";

const MAX_ITEMS = 100;

// True when the host pi-tui exports the fuzzy helpers the scope rules are
// built on. index.ts gates completion registration on this flag and
// reports the host version floor explicitly when it is false.
export const fuzzyAvailable: boolean =
  typeof tui.fuzzyFilter === "function" && typeof tui.fuzzyMatch === "function";

// Session-wide workspace index backing rule 3. Creating it starts no I/O:
// the first query (first completion call) kicks off the async enumeration.
const workspaceIndex: FileIndex = createFileIndex();

// An index entry is a dot path when any component starts with ".". The
// filter runs on the cached entries per query (never at enumeration time),
// so the cache itself stays query-independent (spec dotfile rule).
function isDotPath(entry: string): boolean {
  return entry.split("/").some((part) => part.startsWith("."));
}

function toDirItems(entries: fs.Dirent[], dirPart: string): AutocompleteItem[] {
  return entries.slice(0, MAX_ITEMS).map((entry) => {
    const isDir = entry.isDirectory();
    return {
      value: dirPart + entry.name + (isDir ? "/" : ""),
      label: entry.name + (isDir ? "/" : ""),
      description: isDir ? "dir" : undefined,
    };
  });
}

// Rule 1: unchanged directory browsing -- directories first, then
// case-insensitive by name; dotfiles hidden.
function browseDir(dir: string, dirPart: string): AutocompleteItem[] | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  visible.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName !== bName) return aName < bName ? -1 : 1;
    return 0;
  });
  return toDirItems(visible, dirPart);
}

// Degraded rule 2 and the empty-remainder browse: fuzzyMatch against entry
// names of one fixed directory (non-recursive). Directories group before
// files; within each group order by fuzzy score, breaking ties
// alphabetically -- which keeps a plain "dir/" listing (empty base, every
// score 0) in rule 1's order.
function fuzzyDir(dir: string, dirPart: string, base: string): AutocompleteItem[] | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const showDotfiles = base.startsWith(".");
  const scored: { entry: fs.Dirent; score: number }[] = [];
  for (const entry of entries) {
    if (!showDotfiles && entry.name.startsWith(".")) continue;
    const match = tui.fuzzyMatch(base, entry.name);
    if (match.matches) scored.push({ entry, score: match.score });
  }
  scored.sort((a, b) => {
    const aDir = a.entry.isDirectory() ? 0 : 1;
    const bDir = b.entry.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    if (a.score !== b.score) return a.score - b.score;
    const aName = a.entry.name.toLowerCase();
    const bName = b.entry.name.toLowerCase();
    if (aName !== bName) return aName < bName ? -1 : 1;
    return 0;
  });
  return toDirItems(
    scored.map((s) => s.entry),
    dirPart,
  );
}

// The index-prefix form of dirPart: index entries are workspace-relative
// with "/" separators, so the subtree under dirPart is exactly the entries
// carrying this prefix (the typed dirPart stays the value prefix, so "~/"
// and absolute forms keep working). Returns null when dirPart resolves
// outside the workspace root, where the index has no subtree to serve.
function indexPrefixFor(dirPart: string, cwd: string): string | null {
  const rel = path.relative(cwd, resolvePath(dirPart, cwd));
  if (rel === "") return "";
  // A real parent escape (".." or "../...") -- not a directory merely named
  // "..something".
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/") + "/";
}

// Rule 2 (ready index): recursive fuzzy match over the index subtree under
// dirPart (amended spec rule 2). Entries carrying the index prefix are
// fuzzy-matched on the remainder, so typing penetrates subdirectories in
// one shot. Order by fuzzy score with enumeration order as tiebreak
// (stable sort), capped at MAX_ITEMS; directories carry the enumerator's
// "/" marker (fd-sourced entries carry none -- the bounded degradation
// documented at rule 3).
function fuzzySubtree(entries: string[], dirPart: string, prefix: string, base: string): AutocompleteItem[] {
  const showDotfiles = base.startsWith(".");
  const scored: { entry: string; score: number }[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const remainder = entry.slice(prefix.length);
    // The dotfile rule applies to the remainder (the entry's name within
    // this subtree), not the full path: the user explicitly typed a dot
    // directory like `.github/` to get here, so its ancestor must not hide
    // its children.
    if (!showDotfiles && isDotPath(remainder)) continue;
    // The container directory itself (remainder "") can never match a
    // non-empty base, so it is never offered as its own candidate.
    const match = tui.fuzzyMatch(base, remainder);
    if (match.matches) scored.push({ entry, score: match.score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, MAX_ITEMS).map(({ entry }) => {
    const value = dirPart + entry.slice(prefix.length);
    const isDir = entry.endsWith("/");
    return { value, label: value, description: isDir ? "dir" : undefined };
  });
}

export function completePath(
  argumentPrefix: string,
  cwd: string,
  index: FileIndex = workspaceIndex,
): AutocompleteItem[] | null {
  // Every completion call warms the index (the first call for a root kicks
  // off exactly one async enumeration); the snapshot is consumed by rule 2
  // (ready subtree match) and rule 3 only, so the degraded rule 2 and
  // rule 1 never change behavior with index state.
  const snapshot = index.query(cwd);

  // Split at the last "/": dirPart stays verbatim (including its trailing
  // slash, "" when absent) because it is prepended to every value; base is
  // the fragment matched against entry names.
  const slash = argumentPrefix.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : argumentPrefix.slice(0, slash + 1);
  const base = slash === -1 ? argumentPrefix : argumentPrefix.slice(slash + 1);

  // Rule 1: empty query, unchanged cwd browsing.
  if (argumentPrefix === "") return browseDir(cwd, "");

  // Rule 3: no slash, non-empty query -- fuzzy over the workspace index.
  if (slash === -1) {
    if (!fuzzyAvailable || snapshot.state !== "ready") {
      // building/oversized/failed (or a host without the fuzzy helpers):
      // fall back to rule 1 browsing for the duration.
      return browseDir(cwd, "");
    }
    const candidates = base.startsWith(".")
      ? snapshot.entries
      : snapshot.entries.filter((entry) => !isDotPath(entry));
    // fuzzyFilter sorts by score with a stable sort, so equal scores keep
    // enumeration order -- the index's documented tiebreak source.
    const ranked = tui.fuzzyFilter(candidates, base, (entry) => entry);
    // fd-sourced entries carry no directory marker, so every entry without
    // a trailing "/" is offered as a file: fd's directory candidates
    // degrade to plain files, a bounded degradation accepted to keep one
    // entry format across the git/fd/walk enumeration chain (spec
    // "Workspace index").
    return ranked.slice(0, MAX_ITEMS).map((entry) => {
      const isDir = entry.endsWith("/");
      return {
        value: entry,
        label: entry,
        description: isDir ? "dir" : undefined,
      };
    });
  }

  // Rule 2: query contains a slash. Unreachable through the host
  // (registration is gated on fuzzyAvailable); refuse rather than silently
  // fall back to prefix matching.
  if (!fuzzyAvailable) return null;

  // Empty remainder: dirPart is a complete directory path -- list its
  // immediate entries (browsing equivalent), regardless of index state.
  if (base === "") return fuzzyDir(resolvePath(dirPart, cwd), dirPart, base);

  // Ready index: recursive fuzzy match over the index subtree under
  // dirPart. Any state the index cannot serve from --
  // building/oversized/failed, or dirPart resolving outside the workspace
  // root -- degrades to the pre-amendment non-recursive single-directory
  // listing.
  if (snapshot.state === "ready") {
    const prefix = indexPrefixFor(dirPart, cwd);
    if (prefix !== null) return fuzzySubtree(snapshot.entries, dirPart, prefix, base);
  }
  return fuzzyDir(resolvePath(dirPart, cwd), dirPart, base);
}
