import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { reviewVariant, REVIEW_EDGE } from "../lib/images.ts";

const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#888" } })
    .jpeg()
    .toBuffer();

test("a large image is bounded by REVIEW_EDGE on its longest side, aspect kept", async () => {
  const out = await reviewVariant(await jpeg(2048, 1536));
  const m = await sharp(out).metadata();
  assert.equal(m.format, "jpeg");
  assert.equal(m.width, REVIEW_EDGE);
  assert.equal(m.height, 768);
});

test("a small image is never enlarged", async () => {
  const out = await reviewVariant(await jpeg(400, 500));
  const m = await sharp(out).metadata();
  assert.equal(m.width, 400);
  assert.equal(m.height, 500);
});
