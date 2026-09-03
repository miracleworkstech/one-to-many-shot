import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFilename } from "../lib/names.ts";
test("deterministic filenames", () => {
  assert.equal(
    approvedFilename("HG-002", "morning kitchen counter, steam, warm light", 1),
    "HG-002-morning-kitchen-counter-01.jpg",
  );
  assert.equal(
    approvedFilename("HG-010", "holiday morning, gift-y", 2),
    "HG-010-holiday-morning-gift-y-02.jpg",
  );
  assert.equal(approvedFilename("HG-001", null, 1), "HG-001-styled-01.jpg");
});
