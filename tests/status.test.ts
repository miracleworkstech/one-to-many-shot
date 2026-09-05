import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productStatus,
  byReadingOrder,
  canRetry,
  isPhotoProblem,
  carouselEnd,
  friendlyFailure,
  STATUS_TONE,
  PRODUCT_STATUSES,
} from "../lib/status.ts";
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
test("canRetry: a rejected or failed candidate earns Try again, unless something is in flight", () => {
  assert.equal(canRetry(c("rejected"), "needs_more"), true);
  assert.equal(canRetry(c("failed"), "failed"), true);
  assert.equal(canRetry(c("completed", "approved"), "in_review"), false);
  assert.equal(canRetry(c("rejected", "queued"), "generating"), false);
  assert.equal(canRetry([], "idea_ready"), false);
});
test("isPhotoProblem keys on the PhotoError prefix, not the word anywhere", () => {
  assert.equal(isPhotoProblem("photo not reachable (HTTP 403)"), true);
  assert.equal(isPhotoProblem("photo URL points at localhost"), true);
  assert.equal(isPhotoProblem("Luma could not use the photo"), false);
  assert.equal(isPhotoProblem(null), false);
});
test("carouselEnd: null while deciding or in flight, done at two approvals, else retry or more", () => {
  assert.equal(carouselEnd([], "idea_ready"), null);
  assert.equal(carouselEnd(c("completed", "approved"), "in_review"), null);
  assert.equal(carouselEnd(c("approved", "processing"), "generating"), null);
  assert.deepEqual(carouselEnd(c("approved", "approved", "rejected"), "done"), {
    kind: "done",
    approved: 2,
  });
  assert.deepEqual(carouselEnd(c("approved", "rejected"), "needs_more"), {
    kind: "retry",
    approved: 1,
  });
  assert.deepEqual(carouselEnd(c("failed"), "failed"), {
    kind: "retry",
    approved: 0,
  });
  // Only approvals, but not enough of them: nothing earned Try again, so another set.
  assert.deepEqual(carouselEnd(c("approved"), "needs_more"), {
    kind: "more",
    approved: 1,
  });
});
test("carouselEnd: every failure a photo problem points at the sheet, not Try again", () => {
  const photo = {
    state: "failed" as const,
    failure_reason: "photo not reachable (HTTP 403)",
  };
  assert.deepEqual(carouselEnd([photo, photo], "failed"), {
    kind: "photo",
    approved: 0,
  });
  // A rejection alongside means a human judged something; Try again stands.
  assert.deepEqual(carouselEnd([photo, { state: "rejected" }], "needs_more"), {
    kind: "retry",
    approved: 0,
  });
  // A Luma-side failure is not a photo problem.
  assert.deepEqual(
    carouselEnd(
      [{ state: "failed", failure_reason: "Luma moderated it" }],
      "failed",
    ),
    { kind: "retry", approved: 0 },
  );
});
test("friendlyFailure never shows an HTTP status and names the sheet for photo problems", () => {
  assert.equal(
    friendlyFailure("photo not reachable (HTTP 403)"),
    "We couldn't fetch the product photo from the sheet.",
  );
  assert.equal(
    friendlyFailure("Luma moderated this image (HTTP 422)"),
    "Luma moderated this image",
  );
  assert.equal(
    friendlyFailure(null),
    "Something went wrong while generating this one.",
  );
  assert.doesNotMatch(friendlyFailure("upstream error (HTTP 502)"), /HTTP/);
});
test("STATUS_TONE: one hue per meaning, every status covered", () => {
  for (const s of PRODUCT_STATUSES) assert.ok(STATUS_TONE[s], s);
  assert.deepEqual(
    Object.fromEntries(PRODUCT_STATUSES.map((s) => [s, STATUS_TONE[s]])),
    {
      no_idea: "neutral",
      idea_ready: "neutral",
      generating: "neutral",
      in_review: "amber",
      needs_more: "amber",
      done: "green",
      failed: "red",
    },
  );
});
