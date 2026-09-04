"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";
import { enqueue, nextSkus, type EnqueueResult } from "@/lib/enqueue";
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
  if (note.trim()) {
    const d = db();
    const p = d
      .prepare("select shot_idea from products where sku = ?")
      .get(sku) as { shot_idea: string | null } | undefined;
    d.prepare(
      `update products set shot_idea = ?, shot_idea_source = ${src("edited")}, updated_at = datetime('now') where sku = ?`,
    ).run([p?.shot_idea, note.trim()].filter(Boolean).join(", "), sku);
  }
  const r = enqueue([sku], "retry");
  after(sku);
  return r;
}

export async function resumeWorker(): Promise<void> {
  db().prepare("update settings set paused_reason = null").run();
  after();
}
