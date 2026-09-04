import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-analytics-"));
process.env.DATA_DIR = dir;

const { db } = await import("../lib/db.ts");
const { spendSummary, recentBatches, spendBySku } =
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

test("recent batches show estimate vs actual", () => {
  const [row] = recentBatches(5);
  assert.ok(row);
  assert.equal(row.kind, "next");
  assert.equal(row.estimated_usd, 0.16);
  assert.equal(row.actual_usd.toFixed(2), "0.12");
  assert.equal(row.images, 4);
});

test("spend by sku is what the CSV export reports", () => {
  assert.equal(spendBySku().get("HG-002")?.toFixed(2), "0.12");
});

test("an empty ledger reports nulls, not NaN", () => {
  d.exec("delete from candidates");
  const s = spendSummary();
  assert.equal(s.spent, 0);
  assert.equal(s.costPerApproved, null);
  assert.equal(s.approvalRate, null);
});
