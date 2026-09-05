import type { CandidateState } from "./types";

/** Reading order for the review page, not the database: what the reviewer still has to decide
 *  comes first, then what is on its way, then what she already decided, then what broke.
 *  Newest first within a rank. */
const RANK: Record<CandidateState, number> = {
  completed: 0,
  processing: 1,
  queued: 1,
  approved: 2,
  rejected: 3,
  failed: 4,
};
/** Try again is offered when the reviewer has seen a candidate and said no, or when one never
 *  arrived, and nothing is in flight: a generating product would just queue a second
 *  spend behind the first. */
export const canRetry = (
  cands: { state: CandidateState }[],
  status: ProductStatus,
) =>
  status !== "generating" &&
  cands.some((c) => c.state === "rejected" || c.state === "failed");

/** Every PhotoError message starts with "photo" (lib/photos.ts): the fix is the link in the
 *  sheet, not another attempt. Anything else came back from Luma. */
export const isPhotoProblem = (reason: string | null) =>
  /^photo/i.test(reason ?? "");

export const byReadingOrder = (
  a: { state: CandidateState; id: number },
  b: { state: CandidateState; id: number },
) => RANK[a.state] - RANK[b.state] || b.id - a.id;

export const PRODUCT_STATUSES = [
  "no_idea",
  "idea_ready",
  "generating",
  "in_review",
  "done",
  "needs_more",
  "failed",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const DONE_AT = 2; // approved images that make a product "done" (brief: 2–3)

export function productStatus(
  hasIdea: boolean,
  candidates: { state: CandidateState }[],
): ProductStatus {
  const n = (s: CandidateState) =>
    candidates.filter((c) => c.state === s).length;
  if (n("approved") >= DONE_AT) return "done";
  if (n("queued") + n("processing") > 0) return "generating";
  if (n("completed") > 0) return "in_review";
  if (candidates.length > 0 && n("failed") === candidates.length)
    return "failed";
  if (candidates.length > 0) return "needs_more";
  return hasIdea ? "idea_ready" : "no_idea";
}

export const STATUS_LABEL: Record<ProductStatus, string> = {
  no_idea: "Needs an idea",
  idea_ready: "Ready to generate",
  generating: "Generating",
  in_review: "Waiting for review",
  done: "Done",
  needs_more: "Needs more",
  failed: "Generation failed",
};
