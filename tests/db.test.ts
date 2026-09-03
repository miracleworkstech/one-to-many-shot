import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
process.env.DATA_DIR = dir;
const { db } = await import("../lib/db.ts");
after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
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
