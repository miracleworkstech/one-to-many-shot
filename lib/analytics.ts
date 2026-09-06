// Money and performance reporting only: what was spent, on what outcome, per batch (D7),
// and how long Luma and the reviewers took (Task 22). No rendering, no I/O.
import { db, st, inStates } from "./db";
import type { BatchKind } from "./types";

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

/** Durations in ms between two SQLite datetime('now') stamps, computed by SQLite itself:
 *  the stamps are its own UTC strings, so `julianday` parses them back exactly and JS never
 *  has to guess a timezone. The same expression stamps the worker's log line. Second
 *  resolution, so every value is a multiple of 1000; nulls (rows from before the columns
 *  existed) drop out because julianday(null) is null. */
const msBetween = (a: string, b: string) =>
  `round((julianday(${b}) - julianday(${a})) * 86400000)`;

export interface Percentiles {
  p50: number | null;
  p90: number | null;
  max: number | null;
  n: number;
}

/** Nearest-rank percentile over an ascending array: the value at rank ceil(p/100 * n), so
 *  p50 of [1,2,3,4] is 2 (rank 2) and p90 of [1..10] is 9. The ledger is hundreds of rows;
 *  sorting in SQL and indexing here is the whole algorithm. */
const percentiles = (sorted: number[]): Percentiles => {
  const n = sorted.length;
  const at = (p: number) => (n ? sorted[Math.ceil((p / 100) * n) - 1] : null);
  return { p50: at(50), p90: at(90), max: n ? sorted[n - 1] : null, n };
};

const durations = (from: string, to: string, extraWhere = "") =>
  (
    db()
      .prepare(
        `select ${msBetween(from, to)} as ms from candidates
         where ${from} is not null and ${to} is not null ${extraWhere} order by ms`,
      )
      .all() as { ms: number }[]
  ).map((r) => r.ms);

export interface BatchPerformance {
  id: number;
  kind: BatchKind;
  createdAt: string;
  images: number;
  completed: number;
  failed: number;
  estimatedUsd: number;
  spentUsd: number;
  wallClockMs: number | null;
}

/** What /metrics returns: counts, spend (from spendSummary), Luma latency, decision latency,
 *  the last twenty batches with their wall clock, and throughput. Every null stamp ignored. */
export function performance() {
  const d = db();
  const s = spendSummary();
  const counts = d
    .prepare(
      `select
      coalesce(sum(state = ${st("completed")}), 0) as completed,
      coalesce(sum(state = ${st("rejected")}), 0) as rejected,
      coalesce(sum(state = ${st("failed")}), 0) as failed
    from candidates`,
    )
    .get() as { completed: number; rejected: number; failed: number };
  const batches = d
    .prepare(
      `select b.id, b.kind, b.created_at as createdAt, b.estimated_usd as estimatedUsd,
        count(c.id) as images,
        coalesce(sum(c.state in ${inStates("completed", "approved", "rejected")}), 0) as completed,
        coalesce(sum(c.state = ${st("failed")}), 0) as failed,
        coalesce(sum(c.cost_usd), 0) as spentUsd,
        ${msBetween("min(c.submitted_at)", "max(c.completed_at)")} as wallClockMs
      from batches b left join candidates c on c.batch_id = b.id
      group by b.id order by b.id desc limit 20`,
    )
    .all() as BatchPerformance[];
  // Throughput over the whole ledger: landed images over the span from the first submit to
  // the last landing, counting only images with both stamps so a landing from before the
  // columns existed cannot sit outside the measured window (Codex). Below two completions
  // there is no span, and a span of zero (second-resolution stamps) reads the same way:
  // not enough data, null rather than Infinity.
  const span = d
    .prepare(
      `select count(completed_at) as n,
        ${msBetween("min(submitted_at)", "max(completed_at)")} as spanMs
      from candidates where submitted_at is not null`,
    )
    .get() as { n: number; spanMs: number | null };
  return {
    generated: s.generated,
    completed: counts.completed,
    approved: s.approved,
    rejected: counts.rejected,
    failed: counts.failed,
    spentUsd: s.spent,
    costPerApprovedUsd: s.costPerApproved,
    approvalRate: s.approvalRate,
    lumaMs: percentiles(durations("submitted_at", "completed_at")),
    decisionMs: percentiles(
      durations(
        "completed_at",
        "decided_at",
        `and state in ${inStates("approved", "rejected")}`,
      ),
    ),
    batches,
    imagesPerMinute:
      span.n >= 2 && span.spanMs !== null && span.spanMs > 0
        ? span.n / (span.spanMs / 60_000)
        : null,
  };
}

export function spendBySku(): Map<string, number> {
  const rows = db()
    .prepare(
      "select sku, coalesce(sum(cost_usd),0) as s from candidates group by sku",
    )
    .all() as { sku: string; s: number }[];
  return new Map(rows.map((r) => [r.sku, r.s]));
}
