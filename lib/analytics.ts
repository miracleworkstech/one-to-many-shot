// Money reporting only: what was spent, on what outcome, per batch (D7).
import { db, st, inStates } from "./db";
import type { Batch } from "./types";

export function spendSummary() {
  const r = db()
    .prepare(
      `select
      coalesce(sum(cost_usd), 0) as spent,
      coalesce(sum(case when state = ${st("approved")} then cost_usd end), 0) as spentApproved,
      coalesce(sum(case when state in ${inStates("rejected", "failed")} then cost_usd end), 0) as spentWasted,
      coalesce(sum(case when state in ${inStates("completed", "queued", "processing")} then cost_usd end), 0) as spentPending,
      coalesce(sum(state = ${st("approved")}), 0) as approved,
      coalesce(sum(state in ${inStates("approved", "rejected")}), 0) as decided,
      coalesce(sum(cost_usd > 0), 0) as generated
    from candidates`,
    )
    .get() as {
    spent: number;
    spentApproved: number;
    spentWasted: number;
    spentPending: number;
    approved: number;
    decided: number;
    generated: number;
  };
  return {
    ...r,
    costPerApproved: r.approved ? r.spent / r.approved : null,
    approvalRate: r.decided ? r.approved / r.decided : null,
  };
}

export function recentBatches(limit = 10) {
  return db()
    .prepare(
      `select b.*, count(c.id) as images, coalesce(sum(c.cost_usd), 0) as actual_usd,
      coalesce(sum(c.state = ${st("approved")}), 0) as approved
    from batches b left join candidates c on c.batch_id = b.id
    group by b.id order by b.id desc limit ?`,
    )
    .all(limit) as (Batch & {
    images: number;
    actual_usd: number;
    approved: number;
  })[];
}

export function spendBySku(): Map<string, number> {
  const rows = db()
    .prepare(
      "select sku, coalesce(sum(cost_usd),0) as s from candidates group by sku",
    )
    .all() as { sku: string; s: number }[];
  return new Map(rows.map((r) => [r.sku, r.s]));
}
