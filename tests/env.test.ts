import { test } from "node:test";
import assert from "node:assert/strict";

// env is read once at import, so set the process env before the dynamic import.
process.env.MAX_TOTAL_SPEND_USD = "abc"; // non-numeric: must fall back, never NaN
process.env.MAX_IMAGES_IN_FLIGHT = "7";
delete process.env.LUMA_CONCURRENCY;
const { env, assertProductionEnv } = await import("../lib/env.ts");
// Next's types mark NODE_ENV read-only; Reflect.set bypasses the declaration without a cast.
const setNodeEnv = (v: string) => Reflect.set(process.env, "NODE_ENV", v);

test("numeric env vars: parsed, defaulted, never NaN", () => {
  assert.equal(env.maxInFlight, 7);
  assert.equal(env.lumaConcurrency, 4);
  assert.equal(env.maxTotalSpend, 25);
  assert.ok(Number.isFinite(env.maxTotalSpend));
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
