import { test } from "node:test";
import assert from "node:assert/strict";

import { gutterWidth } from "../../src/viewer/layout.ts";

// Pending-marker field width: a fixed 2 cells (icon renders 1 cell in NF
// Mono + 1 count digit).
const FIELD = 3;

// gutterWidth -----------------------------------------------------------------

test("gutterWidth covers the widest line number, marker field and separators", () => {
  assert.equal(gutterWidth(1), 1 + FIELD + 2); // number + space + field + space
  assert.equal(gutterWidth(9), 1 + FIELD + 2); // single-digit numbers
  assert.equal(gutterWidth(10), 2 + FIELD + 2); // two-digit numbers
  assert.equal(gutterWidth(100), 3 + FIELD + 2); // three-digit numbers
  assert.equal(gutterWidth(0), 1 + FIELD + 2); // degenerate: still one digit wide
});

test("gutterWidth digits track the line count magnitude", () => {
  assert.equal(gutterWidth(99), 2 + FIELD + 2);
  assert.equal(gutterWidth(9999), 4 + FIELD + 2); // four digits + separators
});
