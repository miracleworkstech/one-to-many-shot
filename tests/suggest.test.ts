import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.ANTHROPIC_API_KEY; // no key -> suggestIdeas must never call the network
const { suggestIdeas } = await import("../lib/suggest.ts");

const p = (sku: string, category: string) => ({
  sku,
  name: "x",
  category,
  color: "",
  material: "",
  notes: "",
});

test("no key: category template", async () => {
  const out = await suggestIdeas([p("HG-002", "Ceramics")]);
  assert.equal(
    out.get("HG-002"),
    "on a linen-covered breakfast table by a window, soft morning light",
  );
});

test("no key: unknown category falls back to the generic template", async () => {
  const out = await suggestIdeas([p("HG-099", "Outdoor")]);
  assert.equal(
    out.get("HG-099"),
    "styled in a calm, minimal home setting with natural light",
  );
});

test("empty product list returns an empty map", async () => {
  const out = await suggestIdeas([]);
  assert.equal(out.size, 0);
});
