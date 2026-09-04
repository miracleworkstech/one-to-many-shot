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

/** One product's review screen: the product, its candidates newest first, and the neighbours
 *  in the same priority order the list page uses. `null` when the SKU is unknown. */
export function productDetail(sku: string) {
  const d = db();
  const p = d.prepare("select * from products where sku=?").get(sku) as
    Product | undefined;
  if (!p) return null;
  const cands = d
    .prepare("select * from candidates where sku=? order by id desc")
    .all(sku) as Candidate[];
  // sku only: ~300 rows of one column, not 300 full products, to find two neighbours.
  const nav = (
    d.prepare("select sku from products order by priority desc, sku").all() as {
      sku: string;
    }[]
  ).map((r) => r.sku);
  const i = nav.indexOf(sku);
  // Indexing past the ends yields undefined; say so, since the compiler would claim `string`.
  const prev: string | undefined = nav[i - 1];
  const next: string | undefined = nav[i + 1];
  return { p, cands, status: productStatus(!!p.shot_idea, cands), prev, next };
}
