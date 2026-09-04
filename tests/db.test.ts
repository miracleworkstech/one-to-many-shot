import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
process.env.DATA_DIR = dir;
const { db, SCHEMA } = await import("../lib/db.ts");
after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Runs first, before any other test in this file calls db() and creates the fresh (already
// migrated) schema on this same DATA_DIR: hand-builds the old candidates table (no
// shot_idea column) directly, then calls the real open function and checks it adds the
// column and backfills it from the product.
test("opening a database created with the old schema adds candidates.shot_idea and backfills it from the product", () => {
  const raw = new Database(path.join(dir, "app.db"));
  // The pre-migration schema is the real SCHEMA minus the candidates.shot_idea column:
  // this file's later tests share this same database (one DATA_DIR per file), so an
  // under-built fixture (e.g. missing a CHECK) would silently weaken them. Building it
  // from SCHEMA itself (rather than hand-copied literals) keeps it correct as SCHEMA
  // changes; the assert below fails loudly if the line this depends on is reformatted.
  const oldSchema = SCHEMA.replace("  shot_idea text,\n", "");
  assert.notEqual(
    oldSchema,
    SCHEMA,
    "SCHEMA no longer has that shot_idea line verbatim",
  );
  raw.exec(oldSchema);
  raw
    .prepare(
      "insert into products (sku, name, photo_url, shot_idea) values (?, ?, ?, ?)",
    )
    .run("OLD-1", "Old Product", "https://x/old.jpg", "legacy idea");
  const batchId = raw
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  raw
    .prepare("insert into candidates (sku, batch_id, prompt) values (?, ?, ?)")
    .run("OLD-1", batchId, "p");
  raw.close();

  const d = db(); // the real open function: must add the column and backfill this row
  const cols = (
    d.prepare("pragma table_info(candidates)").all() as { name: string }[]
  ).map((c) => c.name);
  assert.ok(cols.includes("shot_idea"));
  const row = d
    .prepare("select shot_idea from candidates where sku = 'OLD-1'")
    .get() as { shot_idea: string | null };
  assert.equal(row.shot_idea, "legacy idea");
});

test("schema applies and settings row exists", () => {
  const d = db();
  const tables = (
    d.prepare("select name from sqlite_master where type='table'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of ["products", "candidates", "batches", "settings"])
    assert.ok(tables.includes(t), t);
  assert.equal(
    (d.prepare("select count(*) as n from settings").get() as { n: number }).n,
    1,
  );
});
test("database rejects a state the type union does not know", () => {
  const d = db();
  d.prepare(
    "insert into products (sku,name,photo_url) values ('T','t','https://x/a.jpg')",
  ).run();
  const b = d
    .prepare("insert into batches (kind) values ('next')")
    .run().lastInsertRowid;
  assert.throws(
    () =>
      d
        .prepare(
          "insert into candidates (sku,batch_id,prompt,state) values ('T',?,'p','aproved')",
        )
        .run(b),
    /CHECK/,
  );
  assert.throws(
    () => d.prepare("insert into batches (kind) values ('bogus')").run(),
    /CHECK/,
  );
});
test("database rejects a candidate for a product or batch that does not exist", () => {
  const d = db();
  assert.throws(
    () =>
      d
        .prepare(
          "insert into candidates (sku,batch_id,prompt) values ('NOPE',1,'p')",
        )
        .run(),
    /FOREIGN KEY/,
  );
  assert.throws(
    () =>
      d
        .prepare(
          "insert into candidates (sku,batch_id,prompt) values ('T',999,'p')",
        )
        .run(),
    /FOREIGN KEY/,
  );
});
