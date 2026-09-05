import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-img-"));
process.env.DATA_DIR = dir;
const { storage } = await import("../lib/storage.ts");
const { REVIEW_EDGE } = await import("../lib/images.ts");
const { GET } = await import("../app/img/[id]/route.ts");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const get = (id: string) =>
  GET(new Request(`http://x/img/${id}`), { params: Promise.resolve({ id }) });

test("a candidate saved before review copies existed gets one on first request", async () => {
  const original = await sharp({
    create: { width: 2048, height: 2048, channels: 3, background: "#999" },
  })
    .jpeg()
    .toBuffer();
  storage.saveImage(5, original);
  assert.equal(storage.hasReview(5), false);
  const res = await get("5");
  assert.equal(res.status, 200);
  const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.equal(m.width, REVIEW_EDGE, "the response is the review size");
  assert.equal(
    storage.hasReview(5),
    true,
    "and the copy is kept for next time",
  );
  assert.equal(
    storage.readImage(5)?.length,
    original.length,
    "original intact",
  );
});

test("an original that will not decode is served as-is, not a 500", async () => {
  const junk = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  storage.saveImage(6, junk);
  const res = await get("6");
  assert.equal(res.status, 200);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), junk);
  assert.equal(storage.hasReview(6), false);
});

test("bad ids are 404, not a file read", async () => {
  assert.equal((await get("0")).status, 404);
  assert.equal((await get("../x")).status, 404);
  assert.equal((await get("999")).status, 404);
});
