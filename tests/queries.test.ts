import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-queries-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;

const { db } = await import("../lib/db.ts");
const { parseCatalog } = await import("../lib/catalog.ts");
const { importCatalogRows } = await import("../lib/import.ts");
const { overview, productDetail } = await import("../lib/queries.ts");

after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const HEADER =
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes";
// HG-002 and HG-008 are real catalog rows; HG-008's notes mark it "do this one first" (priority).
const rowsCsv =
  [
    HEADER,
    'HG-002,Stoneware Mug 12oz,Ceramics,Sage,Stoneware,$28,https://x/hg-002.jpg,"morning kitchen counter, steam, warm light",',
    'HG-008,Salt + Pepper Cellar Set,Ceramics,Charcoal,Stoneware,$32,https://x/hg-008.jpg,,"do this one first"',
    "HG-003,Cereal Bowl,Ceramics,Dusty Blue,Stoneware,$22,https://x/hg-003.jpg,,",
  ].join("\n") + "\n";

test("overview: rows sorted priority desc then sku, correct status, counts, pausedReason", async () => {
  const { rows: catalogRows } = parseCatalog(rowsCsv);
  await importCatalogRows(catalogRows);

  const { rows, counts, pausedReason } = overview();
  assert.equal(pausedReason, null);
  assert.equal(rows.length, 3);
  // HG-008 is priority, so it sorts first despite the SKU order.
  assert.deepEqual(
    rows.map((r) => r.p.sku),
    ["HG-008", "HG-002", "HG-003"],
  );

  // All three have an idea (HG-008 and HG-003 got a suggested one) and no candidates yet.
  for (const r of rows) assert.equal(r.status, "idea_ready");
  assert.equal(counts.idea_ready, 3);
  assert.equal(counts.no_idea ?? 0, 0);

  const d = db();
  const batchId = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  d.prepare(
    "insert into candidates (sku, batch_id, prompt, state) values ('HG-002', ?, 'p', 'queued')",
  ).run(batchId);

  const after_ = overview();
  const mug = after_.rows.find((r) => r.p.sku === "HG-002")!;
  assert.equal(mug.status, "generating");
  assert.equal(mug.toDecide, 0, "queued is not yet something to decide");
  d.prepare("update candidates set state='completed' where sku='HG-002'").run();
  assert.equal(overview().rows.find((r) => r.p.sku === "HG-002")!.toDecide, 1);
  d.prepare("update candidates set state='approved' where sku='HG-002'").run();
  const one = overview().rows.find((r) => r.p.sku === "HG-002")!;
  assert.equal(one.status, "needs_more");
  assert.equal(one.approved, 1, "the row says how far from done");
  assert.equal(one.toDecide, 0);
  d.prepare("update candidates set state='queued' where sku='HG-002'").run();
  assert.equal(after_.counts.generating, 1);
  assert.equal(after_.counts.idea_ready, 2);
});

test("overview: a product with no idea is 'no_idea' and counted", () => {
  // Inserted directly (not via importCatalogRows, which always fills a blank
  // idea via suggestIdeas) so shot_idea stays null, as updateIdea(sku, "") leaves it.
  db()
    .prepare(
      "insert into products (sku,name,photo_url) values ('HG-099','Blank Product','https://x/hg-099.jpg')",
    )
    .run();
  const { rows, counts } = overview();
  const blank = rows.find((r) => r.p.sku === "HG-099");
  assert.equal(blank?.status, "no_idea");
  assert.equal(counts.no_idea, 1);
});

test("overview: pausedReason surfaces settings.paused_reason", async () => {
  db()
    .prepare("update settings set paused_reason = ? where id = 1")
    .run("Luma credits exhausted");
  const { pausedReason } = overview();
  assert.equal(pausedReason, "Luma credits exhausted");
});

// These run after the tests above: the DB holds HG-008 (priority), HG-002, HG-003 and
// HG-099 (no idea), plus one queued candidate on HG-002.
test("productDetail: null for an unknown SKU", () => {
  assert.equal(productDetail("NOPE-1"), null);
});

test("productDetail: prev/next follow the list order, undefined at the ends", () => {
  // Same order as overview(): priority desc, then sku. HG-008, HG-002, HG-003, HG-099.
  assert.equal(productDetail("HG-008")?.prev, undefined);
  assert.equal(productDetail("HG-008")?.next, "HG-002");
  assert.equal(productDetail("HG-002")?.prev, "HG-008");
  assert.equal(productDetail("HG-002")?.next, "HG-003");
  assert.equal(productDetail("HG-099")?.next, undefined);
  assert.deepEqual(
    [productDetail("HG-002")?.position, productDetail("HG-002")?.total],
    [2, 4],
  );
});

test("productDetail: candidates newest first, status derived from them", () => {
  const d = db();
  const batchId = d
    .prepare("insert into batches (kind) values ('retry')")
    .run().lastInsertRowid;
  const newer = Number(
    d
      .prepare(
        "insert into candidates (sku, batch_id, prompt, state) values ('HG-002', ?, 'p2', 'completed')",
      )
      .run(batchId).lastInsertRowid,
  );

  const detail = productDetail("HG-002");
  assert.equal(detail?.p.name, "Stoneware Mug 12oz");
  assert.equal(detail?.cands.length, 2);
  assert.equal(detail?.cands[0].id, newer, "newest first");
  // One queued, one completed: generating wins (money is in flight).
  assert.equal(detail?.status, "generating");
});
