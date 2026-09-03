import { db } from "./db";
import type { Product, Candidate, CandidateState } from "./types";
import { productStatus, type ProductStatus } from "./status";

export function overview() {
  const d = db();
  const products = d
    .prepare("select * from products order by priority desc, sku")
    .all() as Product[];
  const cands = d.prepare("select sku, state from candidates").all() as Pick<
    Candidate,
    "sku" | "state"
  >[];
  const bySku = new Map<string, { state: CandidateState }[]>();
  for (const c of cands) bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  const rows = products.map((p) => ({
    p,
    status: productStatus(!!p.shot_idea, bySku.get(p.sku) ?? []),
  }));
  const counts: Partial<Record<ProductStatus, number>> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const { paused_reason } = d
    .prepare("select paused_reason from settings")
    .get() as { paused_reason: string | null };
  return { rows, counts, pausedReason: paused_reason };
}
