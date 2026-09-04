"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { MAX_SKU_CHARS } from "@/lib/types";
import {
  enqueue,
  enqueueRetry,
  nextSkus,
  type EnqueueResult,
} from "@/lib/enqueue";
import { tick } from "@/lib/worker";

/** Nudge the worker so the first image starts now instead of up to a tick later. */
function after(sku?: string) {
  void tick();
  revalidatePath("/");
  if (sku) revalidatePath(`/review/${sku}`);
}

export async function generateNext(formData: FormData): Promise<EnqueueResult> {
  // A positive whole number is capped at 40 (the form's own bound); anything else ("abc",
  // 2.5, 0, blank) means the default. This number is the size of the spend: never trusted raw.
  const raw = Number(formData.get("n"));
  const n = Number.isInteger(raw) && raw > 0 ? Math.min(40, raw) : 10;
  const r = enqueue(nextSkus(n), "next");
  after();
  return r;
}

export async function generateSku(sku: string): Promise<EnqueueResult> {
  const r = enqueue([sku], "product");
  after(sku);
  return r;
}

export async function tryAgain(
  sku: string,
  note: string,
): Promise<EnqueueResult> {
  const r = enqueueRetry(sku, note);
  after(sku);
  return r;
}

export async function resumeWorker(): Promise<void> {
  db().prepare("update settings set paused_reason = null").run();
  after();
}

// Not exported: a "use server" module may only export async functions.
const KINDS = ["product", "retry"] as const;
/** Narrows without a cast, the same way `isDecision` does: `.includes` on a `readonly`
 *  tuple demands the union as its argument, which is what we are trying to establish. */
const isKind = (v: string): v is (typeof KINDS)[number] =>
  KINDS.some((k) => k === v);

/** The review page's two generate buttons. Dispatch only; both paths go through the
 *  same caps in `enqueue`, and the result (queued / skipped / refused) goes back to the
 *  button. Everything here comes off a form, so nothing reaches the database until the
 *  kind is one of ours and the SKU is a plausible one. */
export async function generateForProduct(
  formData: FormData,
): Promise<EnqueueResult> {
  const sku = String(formData.get("sku") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!isKind(kind) || !sku || sku.length > MAX_SKU_CHARS)
    return {
      queued: 0,
      skipped: [],
      estimatedUsd: 0,
      refused: "Unknown request.",
    };
  return kind === "retry"
    ? tryAgain(sku, String(formData.get("note") ?? ""))
    : generateSku(sku);
}
