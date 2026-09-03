import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../lib/prompt.ts";
test("prompt names the product and keeps it unchanged", () => {
  const p = buildPrompt(
    {
      name: "Stoneware Mug 12oz",
      color: "Sage",
      material: "Stoneware",
      notes: "El: smoke glass photographs badly, careful?",
    },
    "morning kitchen counter, steam, warm light?",
  );
  assert.match(p, /Stoneware Mug 12oz/);
  assert.match(p, /Sage/);
  assert.match(p, /morning kitchen counter, steam, warm light\./);
  assert.match(p, /identical/i);
  assert.match(p, /Team notes/);
  assert.ok(!p.includes("?"));
});
