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

/** What closes the carousel once nothing is undecided or in flight: `done` when enough
 *  are approved, otherwise the next step (`retry` when a rejection or failure earned Try
 *  again, `more` when only another set makes sense). `null` while there is still something
 *  to decide or wait for, or when there are no candidates at all. */
export function carouselEnd(
  cands: { state: CandidateState; failure_reason?: string | null }[],
  status: ProductStatus,
): { kind: "done" | "retry" | "more" | "photo"; approved: number } | null {
  if (cands.length === 0) return null;
  const n = (s: CandidateState) => cands.filter((c) => c.state === s).length;
  if (n("completed") > 0 || n("queued") + n("processing") > 0) return null;
  const approved = n("approved");
  if (approved >= DONE_AT) return { kind: "done", approved };
  // Nothing was judged and every failure is the photo link: another attempt re-fails at
  // the fetch (cost 0) and adds a card, so the next step is the sheet, not Try again.
  const failed = cands.filter((c) => c.state === "failed");
  if (
    n("rejected") === 0 &&
    failed.length > 0 &&
    failed.every((c) => isPhotoProblem(c.failure_reason ?? null))
  )
    return { kind: "photo", approved };
  return { kind: canRetry(cands, status) ? "retry" : "more", approved };
}

/** What a failed card says. A photo problem is the sheet's to fix and the reason carries an
 *  HTTP status nobody on the team needs; anything else is Luma's own plain-English message,
 *  with any "(HTTP nnn)" trimmed off just in case. */
export function friendlyFailure(reason: string | null): string {
  if (isPhotoProblem(reason))
    return "We couldn't fetch the product photo from the sheet.";
  const plain = (reason ?? "").replace(/\s*\(HTTP \d+\)/g, "").trim();
  return plain || "Something went wrong while generating this one.";
}

/** One hue per meaning (shared visual system): `wait` is on a person (ochre), `ok` is done
 *  (moss), `stop` is broken (clay), everything else is neutral. The page maps a tone to a
 *  dot beside neutral text; the tone never colours the text. */
export const STATUS_TONE: Record<
  ProductStatus,
  "wait" | "ok" | "stop" | "neutral"
> = {
  no_idea: "neutral",
  idea_ready: "neutral",
  generating: "neutral",
  in_review: "wait",
  needs_more: "wait",
  done: "ok",
  failed: "stop",
};

/** Two rounds turned down with nothing kept is a sign the idea is wrong, not the luck; the
 *  end card says so and points at the idea instead of another set. */
export const needsNewIdea = (rejected: number, perProduct: number) =>
  rejected >= 2 * perProduct;

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
