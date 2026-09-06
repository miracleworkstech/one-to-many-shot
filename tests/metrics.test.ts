import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CandidateState } from "../lib/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-metrics-"));
process.env.DATA_DIR = dir;
const { db } = await import("../lib/db.ts");
const { GET } = await import("../app/metrics/route.ts");
type Perf = ReturnType<typeof import("../lib/analytics.ts").performance>;

const d = db();
after(() => {
  d.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = async () => {
  const res = GET();
  assert.equal(res.headers.get("cache-control"), "no-store");
  return (await res.json()) as Perf;
};

// One row with explicit stamps, in the format SQLite's datetime('now') writes.
const ins = d.prepare(
  "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at,decided_at) values ('HG-002',?,'p',?,?,?,?,?)",
);
const seed = (
  batch: number | bigint,
  state: CandidateState,
  stamps: [string | null, string | null, string | null],
  cost = 0.05,
) => ins.run(batch, state, cost, ...stamps);

test("empty ledger: zeros, empty percentiles, no batches, null throughput", async () => {
  const m = await read();
  assert.deepEqual(m, {
    generated: 0,
    completed: 0,
    approved: 0,
    rejected: 0,
    failed: 0,
    spentUsd: 0,
    costPerApprovedUsd: null,
    approvalRate: null,
    lumaMs: { p50: null, p90: null, max: null, n: 0 },
    decisionMs: { p50: null, p90: null, max: null, n: 0 },
    batches: [],
    imagesPerMinute: null,
  });
});

test("two batches: shape, nearest-rank percentiles, one wall clock, nulls where nothing completed", async () => {
  d.prepare(
    "insert into products (sku,name,photo_url) values ('HG-002','Mug','https://x/m.jpg')",
  ).run();
  const b1 = d
    .prepare("insert into batches (kind, estimated_usd) values ('next', 0.20)")
    .run().lastInsertRowid;
  const b2 = d
    .prepare("insert into batches (kind, estimated_usd) values ('retry', 0.10)")
    .run().lastInsertRowid;
  // Batch 1: four landed (Luma 10 s, 20 s, 30 s, 40 s), one failed at cost, one stamped
  // before the columns existed (all null: ignored by every duration, still counted).
  seed(b1, "approved", [
    "2026-09-06 10:00:00",
    "2026-09-06 10:00:10",
    "2026-09-06 10:01:10",
  ]);
  seed(b1, "rejected", [
    "2026-09-06 10:00:05",
    "2026-09-06 10:00:25",
    "2026-09-06 10:00:55",
  ]);
  seed(b1, "completed", ["2026-09-06 10:00:10", "2026-09-06 10:00:40", null]);
  seed(b1, "completed", ["2026-09-06 10:00:20", "2026-09-06 10:01:00", null]);
  seed(b1, "failed", ["2026-09-06 10:00:30", null, null]);
  seed(b1, "approved", [null, null, null]);
  // Batch 2: one still processing, nothing landed.
  seed(b2, "processing", ["2026-09-06 11:00:00", null, null]);

  const m = await read();
  assert.equal(m.generated, 7, "every seeded row carries a cost");
  assert.equal(m.completed, 2);
  assert.equal(m.approved, 2);
  assert.equal(m.rejected, 1);
  assert.equal(m.failed, 1);
  assert.equal(m.spentUsd.toFixed(2), "0.35");
  assert.equal(m.costPerApprovedUsd?.toFixed(3), "0.175");
  assert.equal(m.approvalRate, 2 / 3);
  // Sorted Luma durations: 10 s, 20 s, 30 s, 40 s. Nearest rank: p50 = rank 2, p90 = rank 4.
  assert.deepEqual(m.lumaMs, { p50: 20_000, p90: 40_000, max: 40_000, n: 4 });
  // Decisions: 60 s (approved) and 30 s (rejected); the null-stamped approval is ignored.
  assert.deepEqual(m.decisionMs, {
    p50: 30_000,
    p90: 60_000,
    max: 60_000,
    n: 2,
  });

  assert.equal(m.batches.length, 2);
  const [second, first] = m.batches;
  assert.equal(first.id, Number(b1), "newest first");
  assert.equal(first.kind, "next");
  assert.equal(first.images, 6);
  // By state, not by stamp: the null-stamped approval landed too, before the columns.
  assert.equal(
    first.completed,
    5,
    "completed, approved and rejected all landed",
  );
  assert.equal(first.failed, 1);
  assert.equal(first.estimatedUsd, 0.2);
  assert.equal(first.spentUsd.toFixed(2), "0.30");
  // 10:00:00 (earliest submit) to 10:01:00 (latest landing).
  assert.equal(first.wallClockMs, 60_000);
  assert.equal(second.kind, "retry");
  assert.equal(second.images, 1);
  assert.equal(second.completed, 0);
  assert.equal(second.wallClockMs, null, "nothing completed yet");
  // Four landed over 10:00:00 to 10:01:00.
  assert.equal(m.imagesPerMinute, 4);
});

test("one completion, or two in the same second: throughput is null, not Infinity", async () => {
  d.exec("delete from candidates");
  const b = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  seed(b, "completed", ["2026-09-06 10:00:00", "2026-09-06 10:00:10", null]);
  assert.equal((await read()).imagesPerMinute, null, "one completion: no span");
  d.exec("delete from candidates");
  seed(b, "completed", ["2026-09-06 10:00:00", "2026-09-06 10:00:00", null]);
  seed(b, "completed", ["2026-09-06 10:00:00", "2026-09-06 10:00:00", null]);
  assert.equal((await read()).imagesPerMinute, null, "zero span");
});
