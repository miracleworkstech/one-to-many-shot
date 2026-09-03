import type { CandidateState } from "./types";

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
