import { test } from "node:test";
import assert from "node:assert/strict";
import { productStatus, byReadingOrder } from "../lib/status.ts";
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
test("byReadingOrder: undecided, in flight, decided, failed; newest first within a rank", () => {
  const cs = [
    { id: 1, state: "failed" as const },
    { id: 2, state: "approved" as const },
    { id: 3, state: "completed" as const },
    { id: 4, state: "queued" as const },
    { id: 5, state: "rejected" as const },
    { id: 6, state: "completed" as const },
    { id: 7, state: "processing" as const },
  ];
  assert.deepEqual(
    [...cs].sort(byReadingOrder).map((c) => c.id),
    [6, 3, 7, 4, 2, 5, 1],
  );
});
