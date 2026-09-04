import { test } from "node:test";
import assert from "node:assert/strict";

// env is read once at import, so set the process env before the dynamic import.
process.env.MAX_TOTAL_SPEND_USD = "abc"; // non-numeric: must fall back, never NaN
process.env.MAX_IMAGES_IN_FLIGHT = "7";
process.env.CANDIDATES_PER_PRODUCT = "-1"; // negative count
process.env.LUMA_CONCURRENCY = "1.5"; // fractional count
process.env.WORKER_TICK_MS = "0"; // zero would spin the tick loop
process.env.LUMA_COST_PER_IMAGE_USD = "-0.01"; // negative cost defeats the budget cap
const { env, assertProductionEnv } = await import("../lib/env.ts");
// Next's types mark NODE_ENV read-only; Reflect.set bypasses the declaration without a cast.
const setNodeEnv = (v: string) => Reflect.set(process.env, "NODE_ENV", v);

test("numeric env vars: parsed, defaulted, never NaN, zero or negative", () => {
  assert.equal(env.maxInFlight, 7);
  assert.equal(env.maxTotalSpend, 25); // "abc"
  assert.equal(env.candidatesPerProduct, 2); // "-1"
  assert.equal(env.lumaConcurrency, 4); // "1.5"
  assert.equal(env.tickMs, 5000); // "0"
  assert.equal(env.costPerImage, 0.0434); // "-0.01"
  // Every cap and rate is a positive number, whatever the environment said.
  for (const n of [
    env.costPerImage,
    env.candidatesPerProduct,
    env.maxInFlight,
    env.maxTotalSpend,
    env.lumaConcurrency,
    env.tickMs,
  ])
    assert.ok(Number.isFinite(n) && n > 0);
});

test("assertProductionEnv fails fast only in production", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    LUMA_AGENTS_API_KEY: process.env.LUMA_AGENTS_API_KEY,
    ACCESS_TOKEN: process.env.ACCESS_TOKEN,
  };
  try {
    delete process.env.LUMA_AGENTS_API_KEY;
    delete process.env.ACCESS_TOKEN;
    setNodeEnv("test");
    assert.doesNotThrow(assertProductionEnv);
    setNodeEnv("production");
    assert.throws(assertProductionEnv, /LUMA_AGENTS_API_KEY/);
    process.env.LUMA_AGENTS_API_KEY = "x";
    assert.throws(assertProductionEnv, /ACCESS_TOKEN/);
    process.env.ACCESS_TOKEN = "y";
    assert.doesNotThrow(assertProductionEnv);
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else Reflect.set(process.env, k, v);
  }
});
