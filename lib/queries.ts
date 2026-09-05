import { db } from "./db";
import type { Product, Candidate, CandidateState } from "./types";
import { productStatus, type ProductStatus } from "./status";
import { approvedFilename } from "./names";

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
  const rows = products.map((p) => {
    const mine = bySku.get(p.sku) ?? [];
    return {
      p,
      status: productStatus(!!p.shot_idea, mine),
      // What a reviewer still has to look at on this product; the status page shows it.
      toDecide: mine.filter((c) => c.state === "completed").length,
    };
  });
  const counts: Partial<Record<ProductStatus, number>> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const { paused_reason } = d
    .prepare("select paused_reason from settings")
    .get() as { paused_reason: string | null };
  return { rows, counts, pausedReason: paused_reason };
}

/** One product's review screen: the product, its candidates newest first, the neighbours
 *  in the same priority order the list page uses, and where this SKU sits in that order
 *  (`position` of `total`, for the Prev/Next bar). `null` when the SKU is unknown. */
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
  return {
    p,
    cands,
    status: productStatus(!!p.shot_idea, cands),
    prev,
    next,
    position: i + 1,
    total: nav.length,
  };
}

/** Every product with its approved candidates, named in approval order, for the exports.
 *  ponytail: loads all products and all candidates in two queries and joins them in memory
 *  rather than a per-product query — fine at ~300 products / a few thousand candidates,
 *  the scale named in CLAUDE.md. A join in SQL is the upgrade if the catalog grows an
 *  order of magnitude. */
export function approvedByProduct() {
  const d = db();
  const products = d
    .prepare("select * from products order by sku")
    .all() as Product[];
  const cands = d
    .prepare("select * from candidates order by id")
    .all() as Candidate[];
  return products.map((p) => {
    const mine = cands.filter((c) => c.sku === p.sku);
    const approved = mine
      .filter((c) => c.state === "approved")
      // ponytail: ordered by decided_at (the actual approval order), id as the tiebreaker
      // when decided_at ties or is null. Un-approving a candidate later renumbers everything
      // after it in this ordering (accepted). The slug is built from `c.shot_idea`, the idea
      // snapshotted when the candidate was generated, so editing the product's idea afterward
      // no longer renames it (Task 8d); `?? p.shot_idea` is only for legacy rows generated
      // before that snapshot existed. A stored full filename column is the upgrade the day
      // numbering must also stay stable across un-approval.
      .sort(
        (a, b) =>
          (a.decided_at ?? "").localeCompare(b.decided_at ?? "") || a.id - b.id,
      )
      .map((c, i) => ({
        c,
        name: approvedFilename(p.sku, c.shot_idea ?? p.shot_idea, i + 1),
      }));
    return { p, approved, status: productStatus(!!p.shot_idea, mine) };
  });
}
