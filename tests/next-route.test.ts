import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-next-"));
process.env.DATA_DIR = dir;
const { db } = await import("../lib/db.ts");
const { GET } = await import("../app/next/route.ts");
after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("/next with an empty queue: 302 to the status page's queue heading, uncached", () => {
  const res = GET();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/#decide");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("/next with a product to decide: 302 to its review page", () => {
  const d = db();
  d.prepare(
    "insert into products (sku,name,photo_url,shot_idea) values ('HG-002','Mug','https://x/m.jpg','idea')",
  ).run();
  const batchId = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  d.prepare(
    "insert into candidates (sku, batch_id, prompt, state) values ('HG-002', ?, 'p', 'completed')",
  ).run(batchId);
  assert.equal(GET().headers.get("location"), "/review/HG-002");
});
