import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
process.env.DATA_DIR = dir;
const { storage } = await import("../lib/storage.ts");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("round-trips image bytes by candidate id", () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic
  storage.saveImage(42, bytes);
  assert.deepEqual(storage.readImage(42), bytes);
  assert.equal(storage.imagePath(42), path.join(dir, "images", "42.jpg"));
});

test("missing image reads as null, not an error", () => {
  assert.equal(storage.readImage(999), null);
});

test("review copy is served when present and falls back to the original", () => {
  const original = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01]);
  storage.saveImage(7, original);
  assert.deepEqual(
    storage.readReview(7),
    original,
    "no copy yet: the original",
  );
  const small = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  storage.saveReview(7, small);
  assert.deepEqual(storage.readReview(7), small);
  assert.deepEqual(storage.readImage(7), original, "the original is untouched");
  assert.equal(storage.readReview(999), null);
});
