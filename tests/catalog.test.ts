import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCatalog, isPriority } from "../lib/catalog.ts";

test("parses the customer export", () => {
  const { rows, errors } = parseCatalog(
    fs.readFileSync("data/catalog.csv", "utf8"),
  );
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 40);
  const mug = rows.find((r) => r.sku === "HG-002")!;
  assert.equal(mug.shot_idea, "morning kitchen counter, steam, warm light");
  assert.equal(mug.notes, "El: bestseller, do this one first");
  // 24 blank ideas must be null, not "": Task 3 derives "has an idea" from this.
  assert.equal(rows.filter((r) => r.shot_idea === null).length, 24);
  assert.equal(
    rows.find((r) => r.sku === "HG-008")?.name,
    "Salt + Pepper Cellar Set",
  );
  assert.equal(
    rows.find((r) => r.sku === "HG-018")?.color,
    "Cream Terracotta Sage",
  );
});
test("survives an Excel BOM and skips rows whose Photo is not a URL", () => {
  const { rows, errors } = parseCatalog(
    [
      "\uFEFFSKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
      "HG-001,Vase,Ceramics,,,$1,https://x/a.jpg,,",
      "HG-002,Mug,Ceramics,,,$1,not-a-url,,",
      "",
    ].join(String.fromCharCode(10)),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "HG-001");
  assert.match(errors[0], /HG-002.*Photo/);
});
test("normalises whitespace, case and duplicates", () => {
  const { rows, errors } = parseCatalog(
    "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes\n hg-001 , Vase ,Ceramics,,,$1,https://x/a.jpg,,\nHG-001,Vase 2,Ceramics,,,$1,https://x/a.jpg,,\n",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "HG-001");
  assert.equal(rows[0].name, "Vase 2");
  assert.match(errors[0], /duplicate/i);
});
test("rejects wrong headers with a diff", () => {
  const { rows, errors } = parseCatalog("SKU,Name\nHG-1,x\n");
  assert.equal(rows.length, 0);
  assert.match(errors[0], /missing.*Product Name/i);
});
test("priority from notes", () => {
  assert.equal(isPriority("El: bestseller, do this one first"), true);
  assert.equal(isPriority("top seller, gets reordered constantly"), false);
});
