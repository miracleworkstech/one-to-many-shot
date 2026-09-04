import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-enqueue-"));
process.env.DATA_DIR = dir;
process.env.MAX_IMAGES_IN_FLIGHT = "4";
process.env.MAX_TOTAL_SPEND_USD = "1";

const { db } = await import("../lib/db.ts");
const { enqueue } = await import("../lib/enqueue.ts");
const { env } = await import("../lib/env.ts");

const d = db();
after(() => {
  d.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const [sku, name] of [
  ["HG-002", "Stoneware Mug 12oz"],
  ["HG-003", "Cereal Bowl"],
  ["HG-004", "Serving Platter"],
])
  d.prepare(
    "insert into products (sku,name,photo_url,shot_idea) values (?,?,?,?)",
  ).run(
    sku,
    name,
    `https://take-home-service.lumalabs-ext.workers.dev/assets/fde/${sku.toLowerCase()}.jpg`,
    "morning kitchen counter, steam, warm light",
  );

test("double trigger enqueues once, each trigger is a batch", () => {
  const first = enqueue(["HG-002"], "product");
  assert.equal(first.queued, 2);
  assert.ok(first.batchId);
  const second = enqueue(["HG-002"], "product");
  assert.equal(second.queued, 0);
  assert.deepEqual(second.skipped, ["HG-002"]);
  assert.equal(second.batchId, undefined);
  assert.equal(
    (d.prepare("select count(*) as n from batches").get() as { n: number }).n,
    1,
  );
});

test("in-flight cap refuses", () => {
  const r = enqueue(["HG-003", "HG-004"], "next"); // 2 in flight + 4 planned > 4
  assert.equal(r.queued, 0);
  assert.match(r.refused ?? "", /in flight/);
  assert.equal(
    (d.prepare("select count(*) as n from candidates").get() as { n: number })
      .n,
    2,
    "a refusal creates nothing",
  );
});

test("spend cap refuses", () => {
  d.prepare("update candidates set state='approved', cost_usd=0.5").run(); // spent 1.00 already
  const r = enqueue(["HG-003"], "next");
  assert.equal(r.queued, 0);
  assert.match(r.refused ?? "", /budget/);
});

test("a product without a shot idea is skipped, not queued", () => {
  d.prepare("delete from candidates").run();
  d.prepare("update products set shot_idea = null where sku = 'HG-004'").run();
  const r = enqueue(["HG-004"], "next");
  assert.equal(r.queued, 0);
  assert.deepEqual(r.skipped, ["HG-004"]);
  assert.equal(r.batchId, undefined);
});

test("the in-flight cap admits its last image and refuses the next", () => {
  d.exec("delete from candidates");
  d.prepare(
    "update products set shot_idea = 'morning kitchen counter' where shot_idea is null",
  ).run();
  const atCap = enqueue(["HG-002", "HG-003"], "next"); // 0 + 4 == the cap of 4
  assert.equal(atCap.queued, 4);
  assert.ok(atCap.batchId);
  const overCap = enqueue(["HG-004"], "next"); // 4 + 2 > 4
  assert.equal(overCap.queued, 0);
  assert.match(overCap.refused ?? "", /in flight/);
});

test("images already in flight count against the budget before they cost anything", () => {
  d.exec("delete from candidates");
  const first = enqueue(["HG-002"], "product"); // 2 queued, cost_usd still 0
  assert.equal(first.queued, 2);
  assert.equal(
    (
      d
        .prepare("select coalesce(sum(cost_usd),0) as s from candidates")
        .get() as {
        s: number;
      }
    ).s,
    0,
    "nothing has been charged yet",
  );
  // 4 images cost $0.17; only the two planned ones would fit under $0.10.
  const cap = env.maxTotalSpend;
  env.maxTotalSpend = 0.1;
  try {
    const r = enqueue(["HG-003"], "next");
    assert.equal(r.queued, 0);
    assert.match(r.refused ?? "", /budget/);
  } finally {
    env.maxTotalSpend = cap;
  }
});

test("a processing candidate is charged once, not reserved twice", () => {
  d.exec("delete from candidates");
  const cost = env.costPerImage;
  const cap = env.maxTotalSpend;
  // Round numbers so the boundary is exact in binary: one paid image plus two planned
  // ones is exactly the cap, so double counting the paid one is the only way to refuse.
  env.costPerImage = 0.25;
  env.maxTotalSpend = 0.75;
  try {
    const batch = d
      .prepare("insert into batches (kind) values ('next')")
      .run().lastInsertRowid;
    d.prepare(
      "insert into candidates (sku,batch_id,prompt,state,cost_usd) values ('HG-002',?,'p','processing',?)",
    ).run(batch, env.costPerImage);
    const r = enqueue(["HG-003"], "next");
    assert.equal(r.queued, 2);
    assert.ok(r.batchId);
    assert.equal(r.estimatedUsd, 0.5);
  } finally {
    env.costPerImage = cost;
    env.maxTotalSpend = cap;
  }
});
