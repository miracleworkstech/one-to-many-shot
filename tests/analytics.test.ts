import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-analytics-"));
process.env.DATA_DIR = dir;

const { db } = await import("../lib/db.ts");
const { spendSummary, spendBySku, performance } =
  await import("../lib/analytics.ts");

const d = db();
after(() => {
  d.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

d.prepare(
  "insert into products (sku,name,photo_url,shot_idea) values ('HG-002','Stoneware Mug 12oz','https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-002.jpg','morning kitchen counter')",
).run();
const b = d
  .prepare("insert into batches (kind, estimated_usd) values ('next', 0.16)")
  .run().lastInsertRowid;
const ins = d.prepare(
  "insert into candidates (sku,batch_id,prompt,state,cost_usd) values ('HG-002',?,'p',?,?)",
);
// Asymmetric on purpose: no two of these sums can coincide by accident.
ins.run(b, "approved", 0.05);
ins.run(b, "rejected", 0.03);
ins.run(b, "failed", 0.04);
ins.run(b, "failed", 0);

test("spend by outcome, cost per approved, approval rate", () => {
  const s = spendSummary();
  assert.equal(s.spent.toFixed(2), "0.12");
  assert.equal(s.spentApproved.toFixed(2), "0.05");
  assert.equal(s.spentWasted.toFixed(2), "0.07"); // rejected + failed
  assert.equal(s.approved, 1);
  assert.equal(s.costPerApproved?.toFixed(2), "0.12");
  assert.equal(s.approvalRate, 0.5); // 1 approved of 2 decided
});

test("spend by sku is what the CSV export reports", () => {
  assert.equal(spendBySku().get("HG-002")?.toFixed(2), "0.12");
});

test("performance() reuses spendSummary's money and ignores null stamps", () => {
  const p = performance();
  assert.equal(p.spentUsd, spendSummary().spent);
  assert.equal(p.approvalRate, 0.5);
  assert.equal(p.generated, 3, "the zero-cost failure never reached Luma");
  assert.deepEqual([p.approved, p.rejected, p.failed], [1, 1, 2]);
  // No row has a stamp yet: nothing to time, and no NaN anywhere.
  assert.deepEqual(p.lumaMs, { p50: null, p90: null, max: null, n: 0 });
  assert.deepEqual(p.decisionMs, { p50: null, p90: null, max: null, n: 0 });
  assert.equal(p.batches[0]?.wallClockMs, null);
  assert.equal(p.imagesPerMinute, null);
});

test("percentiles are nearest-rank over the sorted durations", () => {
  // Ten landed images at 1 s .. 10 s: p50 is rank 5 (5 s), p90 rank 9 (9 s), max 10 s.
  for (let i = 1; i <= 10; i++)
    d.prepare(
      "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at) values ('HG-002',?,'p','completed',0.05,'2026-09-06 10:00:00',?)",
    ).run(b, `2026-09-06 10:00:${String(i).padStart(2, "0")}`);
  const { lumaMs } = performance();
  assert.deepEqual(lumaMs, { p50: 5000, p90: 9000, max: 10_000, n: 10 });
});

test("an empty ledger reports nulls, not NaN", () => {
  d.exec("delete from candidates");
  const s = spendSummary();
  assert.equal(s.spent, 0);
  assert.equal(s.costPerApproved, null);
  assert.equal(s.approvalRate, null);
});

test("decisionMs counts only approved and rejected rows, whatever else carries a decided_at", () => {
  d.exec("delete from candidates");
  const row = d.prepare(
    "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at,decided_at) values ('HG-002',?,'p',?,0.05,'2026-09-06 10:00:00','2026-09-06 10:00:10',?)",
  );
  row.run(b, "approved", "2026-09-06 10:01:10");
  // A completed row with a stray decided_at is not a decision and must not count.
  row.run(b, "completed", "2026-09-06 10:05:10");
  assert.deepEqual(performance().decisionMs, {
    p50: 60_000,
    p90: 60_000,
    max: 60_000,
    n: 1,
  });
});

test("imagesPerMinute is null on a zero span, not Infinity", () => {
  d.exec("delete from candidates");
  // Two images landed in the same second: second-resolution stamps make the span zero.
  for (let i = 0; i < 2; i++)
    d.prepare(
      "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at) values ('HG-002',?,'p','completed',0.05,'2026-09-06 10:00:00','2026-09-06 10:00:00')",
    ).run(b);
  // Read the function, not the JSON route: JSON.stringify would turn Infinity into null too.
  assert.equal(performance().imagesPerMinute, null);
});

test("imagesPerMinute ignores a landing from before the stamps existed", () => {
  d.exec("delete from candidates");
  // One legacy image (no submitted_at) and two stamped ones ten seconds apart: the legacy
  // landing must not enter the numerator, so it is 2 images over 10 s, not 3.
  d.prepare(
    "insert into candidates (sku,batch_id,prompt,state,cost_usd,completed_at) values ('HG-002',?,'p','completed',0.05,'2026-09-06 09:00:00')",
  ).run(b);
  d.prepare(
    "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at) values ('HG-002',?,'p','completed',0.05,'2026-09-06 10:00:00','2026-09-06 10:00:05')",
  ).run(b);
  d.prepare(
    "insert into candidates (sku,batch_id,prompt,state,cost_usd,submitted_at,completed_at) values ('HG-002',?,'p','completed',0.05,'2026-09-06 10:00:00','2026-09-06 10:00:10')",
  ).run(b);
  assert.equal(performance().imagesPerMinute, 12);
});
