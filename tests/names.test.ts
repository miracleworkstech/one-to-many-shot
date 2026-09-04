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
test("a hostile SKU cannot become a zip path", () => {
  const name = approvedFilename("../../etc/x", "idea", 1);
  assert.ok(
    !name.includes("/") && !name.includes(String.fromCharCode(92)),
    "no path separators",
  );
  assert.doesNotMatch(name, /\.\./);
  assert.equal(name, "-etc-x-idea-01.jpg");
});
