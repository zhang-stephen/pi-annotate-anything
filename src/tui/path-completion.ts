// Filesystem path completion for the /annotate argument. Pure logic, no UI:
// given the typed prefix and a cwd, return candidate AutocompleteItems, or
// null when the target directory cannot be read (the caller decides what to
// show in that case, e.g. fall back to no completions).

import fs from "node:fs";

import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { resolvePath } from "../core/file-range.ts";

const MAX_ITEMS = 100;

export function completePath(argumentPrefix: string, cwd: string): AutocompleteItem[] | null {
  // Split at the last "/": dirPart stays verbatim (including its trailing
  // slash, "" when absent) because it is prepended to every value; base is
  // the fragment matched against entry names.
  const slash = argumentPrefix.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : argumentPrefix.slice(0, slash + 1);
  const base = slash === -1 ? argumentPrefix : argumentPrefix.slice(slash + 1);
  const dir = dirPart === "" ? cwd : resolvePath(dirPart, cwd);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const showDotfiles = base.startsWith(".");
  const matches = entries.filter(
    (entry) => (showDotfiles || !entry.name.startsWith(".")) && entry.name.startsWith(base),
  );

  // Directories first, then case-insensitive by name.
  matches.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName !== bName) return aName < bName ? -1 : 1;
    return 0;
  });

  return matches.slice(0, MAX_ITEMS).map((entry) => {
    const isDir = entry.isDirectory();
    return {
      value: dirPart + entry.name + (isDir ? "/" : ""),
      label: entry.name + (isDir ? "/" : ""),
      description: isDir ? "dir" : undefined,
    };
  });
}
