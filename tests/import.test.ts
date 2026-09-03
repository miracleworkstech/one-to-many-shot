import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-import-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY; // keep suggestIdeas on the template path; tests must never hit the network

const { db } = await import("../lib/db.ts");
const { parseCatalog } = await import("../lib/catalog.ts");
const { importCatalogRows } = await import("../lib/import.ts");
import type { Product } from "../lib/types.ts";

after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const HEADER =
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes";
const csv = (rows: string[]) => [HEADER, ...rows].join("\n") + "\n";

// Real catalog rows (data/catalog.csv): HG-002 ships with a sheet idea, HG-003 is blank.
const mugRow =
  'HG-002,Stoneware Mug 12oz,Ceramics,Sage,Stoneware,$28,https://x/hg-002.jpg,"morning kitchen counter, steam, warm light","El: bestseller, do this one first"';
const bowlRowBlank =
  "HG-003,Cereal Bowl,Ceramics,Dusty Blue,Stoneware,$22,https://x/hg-003.jpg,,";
const bowlRowIdea =
  'HG-003,Cereal Bowl,Ceramics,Dusty Blue,Stoneware,$22,https://x/hg-003.jpg,"styled bowl on a table",';

function product(sku: string): Product {
  return db()
    .prepare("select * from products where sku = ?")
    .get(sku) as Product;
}

// Tests share one on-disk DB (like tests/db.test.ts); start each from a clean slate.
function reset() {
  db().exec(
    "delete from candidates; delete from batches; delete from products;",
  );
}

test("upsert by SKU: import then re-import does not duplicate products", async () => {
  reset();
  const { rows } = parseCatalog(csv([mugRow, bowlRowBlank]));
  await importCatalogRows(rows);
  await importCatalogRows(rows);
  const count = (
    db().prepare("select count(*) as n from products").get() as { n: number }
  ).n;
  assert.equal(count, 2);
});

test("blank rows get a suggested idea with source 'suggested'", async () => {
  reset();
  const { rows } = parseCatalog(csv([bowlRowBlank]));
  const result = await importCatalogRows(rows);
  assert.equal(result.imported, 1);
  assert.equal(result.suggested, 1);
  const bowl = product("HG-003");
  assert.ok(bowl.shot_idea);
  assert.equal(bowl.shot_idea_source, "suggested");
});

test("a sheet idea overrides a blank one on re-import", async () => {
  reset();
  const { rows: blank } = parseCatalog(csv([bowlRowBlank]));
  await importCatalogRows(blank); // gets a suggested idea
  const before = product("HG-003");
  assert.equal(before.shot_idea_source, "suggested");

  const { rows: withIdea } = parseCatalog(csv([bowlRowIdea]));
  await importCatalogRows(withIdea);
  const after_ = product("HG-003");
  assert.equal(after_.shot_idea, "styled bowl on a table");
  assert.equal(after_.shot_idea_source, "sheet");
});

test("a blank sheet idea on re-import keeps the existing idea and its source", async () => {
  reset();
  const { rows: withIdea } = parseCatalog(csv([bowlRowIdea]));
  await importCatalogRows(withIdea);
  const before = product("HG-003");
  assert.equal(before.shot_idea_source, "sheet");

  const { rows: blank } = parseCatalog(csv([bowlRowBlank]));
  await importCatalogRows(blank);
  const after_ = product("HG-003");
  assert.equal(after_.shot_idea, "styled bowl on a table");
  assert.equal(after_.shot_idea_source, "sheet");
});

test("re-import keeps existing candidates untouched (money path #9)", async () => {
  reset();
  const { rows } = parseCatalog(csv([mugRow]));
  await importCatalogRows(rows);
  const d = db();
  const batchId = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  d.prepare(
    "insert into candidates (sku, batch_id, prompt) values ('HG-002', ?, 'p')",
  ).run(batchId);

  await importCatalogRows(rows);

  const n = (
    d
      .prepare("select count(*) as n from candidates where sku = 'HG-002'")
      .get() as {
      n: number;
    }
  ).n;
  assert.equal(n, 1);
});

test("a race with updateIdea during suggestIdeas' await does not clobber the edit", async () => {
  reset();
  const { rows } = parseCatalog(csv([bowlRowBlank]));
  // Simulates a human editing the idea (updateIdea -> shot_idea_source='edited')
  // while suggestIdeas' network await is still in flight; the write here lands
  // before importCatalogRows' suggestion update runs.
  const raceSuggest = async (products: Product[]) => {
    db()
      .prepare(
        "update products set shot_idea = 'a hand-picked idea', shot_idea_source = 'edited' where sku = 'HG-003'",
      )
      .run();
    return new Map(products.map((p) => [p.sku, "should never land"]));
  };
  await importCatalogRows(rows, raceSuggest);
  const after_ = product("HG-003");
  assert.equal(after_.shot_idea, "a hand-picked idea");
  assert.equal(after_.shot_idea_source, "edited");
});

test("an existing 'edited' idea is not overwritten by suggestions", async () => {
  reset();
  const { rows } = parseCatalog(csv([bowlRowBlank]));
  await importCatalogRows(rows); // suggested idea
  db()
    .prepare(
      "update products set shot_idea = 'a hand-picked idea', shot_idea_source = 'edited' where sku = 'HG-003'",
    )
    .run();

  await importCatalogRows(rows); // blank sheet row again, should not disturb the edit
  const after_ = product("HG-003");
  assert.equal(after_.shot_idea, "a hand-picked idea");
  assert.equal(after_.shot_idea_source, "edited");
});
