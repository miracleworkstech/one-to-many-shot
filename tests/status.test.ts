import { test } from "node:test";
import assert from "node:assert/strict";
import { productStatus } from "../lib/status.ts";
import type { CandidateState } from "../lib/types.ts";
const c = (...states: CandidateState[]) => states.map((state) => ({ state }));
test("status ladder", () => {
  assert.equal(productStatus(false, []), "no_idea");
  assert.equal(productStatus(true, []), "idea_ready");
  assert.equal(productStatus(true, c("queued")), "generating");
  assert.equal(productStatus(true, c("completed", "completed")), "in_review");
  assert.equal(productStatus(true, c("approved", "rejected")), "needs_more");
  assert.equal(
    productStatus(true, c("approved", "approved", "processing")),
    "done",
  );
});
test("failures are visible, not folded into needs_more", () => {
  assert.equal(productStatus(true, c("failed", "failed")), "failed"); // nothing for a human to judge
  assert.equal(productStatus(true, c("failed", "rejected")), "needs_more"); // Ellie saw one; she can try again
  assert.equal(productStatus(true, c("failed", "approved")), "needs_more"); // partial success
  assert.equal(productStatus(true, c("failed", "queued")), "generating");
});
