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
const { enqueue, enqueueRetry } = await import("../lib/enqueue.ts");
const { env } = await import("../lib/env.ts");
const { MAX_IDEA_CHARS } = await import("../lib/types.ts");

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
  const rows = d
    .prepare("select shot_idea from candidates where sku = 'HG-002'")
    .all() as { shot_idea: string | null }[];
  assert.ok(rows.length > 0);
  for (const r of rows)
    assert.equal(r.shot_idea, "morning kitchen counter, steam, warm light");
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

// enqueueRetry: the note joins the idea before the prompts are built, so a retry that never
// happens must not leave the idea rewritten (money path #11 on the review screen).
const idea = (sku: string) =>
  d
    .prepare("select shot_idea, shot_idea_source from products where sku = ?")
    .get(sku) as { shot_idea: string | null; shot_idea_source: string | null };

test("enqueueRetry: a queued retry keeps the note and is its own batch", () => {
  d.exec("delete from candidates; delete from batches;");
  d.prepare(
    "update products set shot_idea = 'a long table, linen', shot_idea_source = 'sheet' where sku = 'HG-002'",
  ).run();

  const r = enqueueRetry("HG-002", "  warmer light  ");
  assert.equal(r.queued, 2);
  assert.ok(r.batchId);
  assert.equal(
    (
      d.prepare("select kind from batches where id = ?").get(r.batchId) as {
        kind: string;
      }
    ).kind,
    "retry",
  );
  assert.deepEqual(idea("HG-002"), {
    shot_idea: "a long table, linen, warmer light",
    shot_idea_source: "edited",
  });
  const rows = d
    .prepare("select shot_idea from candidates where sku = 'HG-002'")
    .all() as { shot_idea: string | null }[];
  assert.ok(rows.length > 0);
  for (const row of rows)
    assert.equal(row.shot_idea, "a long table, linen, warmer light");
});

test("enqueueRetry: a refused retry leaves the idea exactly as it was", () => {
  d.exec("delete from candidates; delete from batches;");
  d.prepare(
    "update products set shot_idea = 'a long table, linen', shot_idea_source = 'sheet' where sku = 'HG-002'",
  ).run();
  const batch = d
    .prepare("insert into batches (kind) values ('next')")
    .run().lastInsertRowid;
  for (let i = 0; i < env.maxInFlight; i++)
    d.prepare(
      "insert into candidates (sku,batch_id,prompt,state) values ('HG-004',?,'p','queued')",
    ).run(batch); // in flight is now at the cap

  const r = enqueueRetry("HG-002", "warmer light");
  assert.equal(r.queued, 0);
  assert.match(r.refused ?? "", /in flight/);
  assert.deepEqual(
    idea("HG-002"),
    { shot_idea: "a long table, linen", shot_idea_source: "sheet" },
    "the note is rolled back with the batch that never happened",
  );
  assert.equal(
    (
      d
        .prepare("select count(*) as n from batches where kind = 'retry'")
        .get() as {
        n: number;
      }
    ).n,
    0,
  );
});

test("enqueueRetry: the note is bounded, so the idea column and the prompt are too", () => {
  d.exec("delete from candidates; delete from batches;");
  d.prepare(
    "update products set shot_idea = 'a long table', shot_idea_source = 'sheet' where sku = 'HG-002'",
  ).run();

  const r = enqueueRetry("HG-002", "x".repeat(900));
  assert.equal(r.queued, 2);
  assert.equal(idea("HG-002").shot_idea?.length, MAX_IDEA_CHARS);
});

test("enqueueRetry: a product with no idea is skipped, and the note is not written as one", () => {
  d.exec("delete from candidates; delete from batches;");
  d.prepare(
    "update products set shot_idea = null, shot_idea_source = null where sku = 'HG-004'",
  ).run();

  const r = enqueueRetry("HG-004", "warmer light");
  assert.equal(r.queued, 0);
  assert.deepEqual(r.skipped, ["HG-004"]);
  assert.deepEqual(idea("HG-004"), {
    shot_idea: null,
    shot_idea_source: null,
  });
});

test("enqueueRetry: a rollback restores updated_at too, not just the idea", () => {
  d.exec("delete from candidates; delete from batches;");
  d.prepare(
    "update products set shot_idea = 'a long table', shot_idea_source = 'sheet', updated_at = '2020-01-01 00:00:00' where sku = 'HG-002'",
  ).run();
  const batch = d
    .prepare("insert into batches (kind) values ('next')")
    .run().lastInsertRowid;
  for (let i = 0; i < env.maxInFlight; i++)
    d.prepare(
      "insert into candidates (sku,batch_id,prompt,state) values ('HG-003',?,'p','queued')",
    ).run(batch);

  const r = enqueueRetry("HG-002", "warmer light");
  assert.equal(r.queued, 0);
  assert.deepEqual(
    d
      .prepare(
        "select shot_idea, shot_idea_source, updated_at from products where sku = 'HG-002'",
      )
      .get(),
    {
      shot_idea: "a long table",
      shot_idea_source: "sheet",
      updated_at: "2020-01-01 00:00:00",
    },
  );
});
