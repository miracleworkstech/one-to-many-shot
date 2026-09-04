import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { unzipSync } from "fflate";
import type { CandidateState } from "../lib/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-export-"));
process.env.DATA_DIR = dir;
process.env.APP_URL = "http://test.local";
process.env.ACCESS_TOKEN = "tok123";
delete process.env.ANTHROPIC_API_KEY;

const { db } = await import("../lib/db.ts");
const { storage } = await import("../lib/storage.ts");
const { parseCatalog } = await import("../lib/catalog.ts");
const { importCatalogRows } = await import("../lib/import.ts");
const { exportCsv, exportZip, exportZipPlan, zipSizeFor } =
  await import("../lib/export.ts");
const { approvedByProduct } = await import("../lib/queries.ts");
const { approvedFilename } = await import("../lib/names.ts");
const { STATUS_LABEL } = await import("../lib/status.ts");

after(() => {
  db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const noSuggest = async () => new Map<string, string>();

// exportZip() now returns a ReadableStream (D14); collect it the same way a real client
// would (via Response) before handing it to unzipSync for assertions.
const collectZip = async (stream: ReadableStream<Uint8Array>) =>
  unzipSync(Buffer.from(await new Response(stream).arrayBuffer()));

// The load-bearing assertion for the Content-Length header: whatever exportZipPlan()
// promised is byte-for-byte what the stream produces. This is what pins the size
// arithmetic in zipSizeFor() to the fflate version in package.json.
const assertExactLength = async () => {
  const plan = exportZipPlan();
  const bytes = await new Response(exportZip(plan)).arrayBuffer();
  assert.equal(plan.contentLength, bytes.byteLength);
};

const HEADER =
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes,Status,Approved Images,Approved Filenames,Spent (USD)";

test("empty database: CSV is exactly the header row, zip contains only manifest.csv", async () => {
  assert.equal(exportCsv(), HEADER + "\n");
  const zip = await collectZip(exportZip());
  assert.deepEqual(Object.keys(zip), ["manifest.csv"]);
  await assertExactLength();
});

// HG-002 gets two approved candidates (in a known decided_at order), one rejected, one
// completed. HG-003 gets one approved candidate whose image is never saved (missing file).
// HG-008 gets none. Rows should still come back SKU-ordered: HG-002, HG-003, HG-008.
const rowsCsv =
  [
    "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
    'HG-002,Stoneware Mug 12oz,Ceramics,Sage,Stoneware,$28,https://x/hg-002.jpg,"morning kitchen counter, steam, warm light",',
    "HG-003,Cereal Bowl,Ceramics,Dusty Blue,Stoneware,$22,https://x/hg-003.jpg,,",
    'HG-008,Salt + Pepper Cellar Set,Ceramics,Charcoal,Stoneware,$32,https://x/hg-008.jpg,,"do this one first"',
  ].join("\n") + "\n";

let first: number, second: number, missing: number;
let name1: string, name2: string, missingName: string;

test("exportCsv: SKU-ordered rows, approved links/filenames/spend, original columns preserved", async () => {
  const { rows } = parseCatalog(rowsCsv);
  await importCatalogRows(rows, noSuggest);

  const d = db();
  const batchId = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  const insert = (
    sku: string,
    state: CandidateState,
    decidedAt: string | null,
    cost: number,
  ) =>
    Number(
      d
        .prepare(
          "insert into candidates (sku, batch_id, prompt, state, decided_at, cost_usd) values (?, ?, 'p', ?, ?, ?)",
        )
        .run(sku, batchId, state, decidedAt, cost).lastInsertRowid,
    );
  // The lower id was approved LATER, so decided_at order differs from id order.
  first = insert("HG-002", "approved", "2026-09-01 10:05:00", 0.05);
  second = insert("HG-002", "approved", "2026-09-01 10:00:00", 0.05);
  insert("HG-002", "rejected", "2026-09-01 09:00:00", 0.04);
  insert("HG-002", "completed", null, 0.03);
  insert("HG-002", "failed", null, 0.04); // cost is kept on failure
  storage.saveImage(first, Buffer.from("img1"));
  storage.saveImage(second, Buffer.from("img2"));

  missing = insert("HG-003", "approved", "2026-09-01 11:00:00", 0.04);
  // no storage.saveImage for `missing`: its file is absent on disk.

  const csv = exportCsv();
  const records = parseCsv(csv, { columns: true }) as Record<string, string>[];
  assert.deepEqual(
    records.map((r) => r.SKU),
    ["HG-002", "HG-003", "HG-008"],
  );

  const mug = records.find((r) => r.SKU === "HG-002");
  assert.ok(mug, "HG-002 row present");
  assert.equal(mug["Product Name"], "Stoneware Mug 12oz");
  assert.equal(mug.Category, "Ceramics");
  assert.equal(mug["Color / Finish"], "Sage");
  assert.equal(mug.Material, "Stoneware");
  assert.equal(mug.Price, "$28");
  assert.equal(mug.Photo, "https://x/hg-002.jpg");
  assert.equal(mug["Shot Idea"], "morning kitchen counter, steam, warm light");
  assert.equal(mug.Notes, "");
  // Two approved candidates hits DONE_AT: the product is "done".
  assert.equal(mug.Status, STATUS_LABEL.done);
  assert.equal(
    mug["Approved Images"],
    `http://test.local/img/${second}?k=tok123; http://test.local/img/${first}?k=tok123`,
  );
  name1 = approvedFilename(
    "HG-002",
    "morning kitchen counter, steam, warm light",
    1,
  );
  name2 = approvedFilename(
    "HG-002",
    "morning kitchen counter, steam, warm light",
    2,
  );
  assert.equal(
    mug["Approved Filenames"],
    `${name1}; ${name2}`,
    "decided_at order, not id order",
  );
  assert.equal(mug["Spent (USD)"], "0.21", "includes the failed candidate");

  const bowl = records.find((r) => r.SKU === "HG-003");
  assert.ok(bowl, "HG-003 row present");
  missingName = approvedFilename("HG-003", null, 1);
  assert.equal(
    bowl["Approved Filenames"],
    missingName,
    "listed in the manifest even though its file is missing",
  );
  assert.equal(
    bowl["Approved Images"],
    `http://test.local/img/${missing}?k=tok123`,
  );
});

test("a shot idea with a comma and a double quote round-trips through parseCatalog(exportCsv())", async () => {
  const tricky = 'He said "hello", then left';
  const csvIn =
    [
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
      `HG-100,Odd Product,Ceramics,White,Stoneware,$10,https://x/hg-100.jpg,"He said ""hello"", then left",`,
    ].join("\n") + "\n";
  const { rows } = parseCatalog(csvIn);
  await importCatalogRows(rows, noSuggest);

  const { rows: roundTripped } = parseCatalog(exportCsv());
  const row = roundTripped.find((r) => r.sku === "HG-100");
  assert.equal(row?.shot_idea, tricky);
});

test("exportZip: exactly the two approved filenames plus manifest.csv; a missing file is omitted but stays in the manifest", async () => {
  const zip = await collectZip(exportZip());
  const keys = Object.keys(zip).sort();
  assert.deepEqual(keys, [name1, name2, "manifest.csv"].sort());
  // -01 is the earliest approval (second, "img2"); -02 is first ("img1").
  assert.deepEqual(zip[name1], new Uint8Array(Buffer.from("img2")));
  assert.deepEqual(zip[name2], new Uint8Array(Buffer.from("img1")));
  const manifest = new TextDecoder().decode(zip["manifest.csv"]);
  assert.ok(
    manifest.includes(missingName),
    "missing-file candidate is still listed in the manifest",
  );
});

test("exportZip: Content-Length is exact for a real fixture (two files, one missing, manifest)", async () => {
  const plan = exportZipPlan();
  assert.deepEqual(
    plan.files.map((f) => f.name).sort(),
    [name1, name2].sort(),
    "the missing-file candidate is not in the plan",
  );
  await assertExactLength();
});

test("zipSizeFor: matches a real fflate archive, multi-byte name and empty file included", async () => {
  const { Zip, ZipPassThrough } = await import("fflate");
  const entries: [string, Uint8Array][] = [
    ["manifest.csv", new TextEncoder().encode("SKU,Notes\nHG-002,ok\n")],
    ["café-über-01.jpg", new Uint8Array(1000).fill(7)],
    ["empty.jpg", new Uint8Array(0)],
  ];
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, chunk, final) => {
      if (err) reject(err);
      else {
        if (chunk) chunks.push(chunk);
        if (final) resolve();
      }
    });
    for (const [name, data] of entries) {
      const e = new ZipPassThrough(name);
      zip.add(e);
      e.push(data, true);
    }
    zip.end();
  });
  const real = chunks.reduce((n, c) => n + c.length, 0);
  assert.ok(
    entries.some(([n]) => Buffer.byteLength(n, "utf8") !== n.length),
    "fixture must include a name whose UTF-8 length differs from its char count",
  );
  assert.equal(
    zipSizeFor(
      entries.map(([name, data]) => ({
        nameBytes: Buffer.byteLength(name, "utf8"),
        size: data.length,
      })),
    ),
    real,
  );
  assert.equal(zipSizeFor([]), 22, "an empty archive is just the EOCD record");
});

test("zipSizeFor refuses a zip past the 4 GB zip64 boundary instead of truncating", () => {
  assert.throws(
    () => zipSizeFor([{ nameBytes: 10, size: 0x1_0000_0000 }]),
    /over 4 GB/,
  );
  // 0xFFFFFFFF total is the last size that still fits every 4-byte field.
  assert.equal(
    zipSizeFor([{ nameBytes: 0, size: 0xffffffff - 114 }]),
    0xffffffff,
  );
  // A name is a 2-byte length field: 65535 bytes fits, 65536 does not.
  assert.ok(zipSizeFor([{ nameBytes: 0xffff, size: 0 }]) > 0);
  assert.throws(
    () => zipSizeFor([{ nameBytes: 0x10000, size: 0 }]),
    /over 4 GB/,
  );
  // The entry count is a 2-byte field whose 0xffff value is the zip64 sentinel.
  const entry = { nameBytes: 1, size: 0 };
  assert.ok(zipSizeFor(Array.from({ length: 0xfffe }, () => entry)) > 0);
  assert.throws(
    () => zipSizeFor(Array.from({ length: 0xffff }, () => entry)),
    /over 4 GB/,
  );
});

test("exportZip streams lazily: reading only the first chunk has not read every approved image yet (D14)", async () => {
  const totalApproved = approvedByProduct().reduce(
    (n, r) => n + r.approved.length,
    0,
  );
  assert.ok(
    totalApproved > 0,
    "test setup needs at least one approved candidate",
  );
  let calls = 0;
  const real = storage.readImage;
  storage.readImage = (id) => {
    calls++;
    return real(id);
  };
  try {
    const reader = exportZip().getReader();
    await reader.read();
    // The manifest goes first, so the first chunk needs no image at all.
    assert.equal(
      calls,
      0,
      `expected no image read after the first chunk, got ${calls}`,
    );
    // Keep pulling until the first image is touched: fflate emits the manifest's
    // header and data as separate chunks, so this takes a few reads.
    for (let n = 0; n < 10 && calls === 0; n++) await reader.read();
    assert.equal(calls, 1, "exactly one image read once entries start");
    assert.ok(calls < totalApproved);
    await reader.cancel();
  } finally {
    storage.readImage = real;
  }
});

test("approvedByProduct: status for a product with only failed candidates matches productStatus", async () => {
  const csvIn =
    [
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
      "HG-101,Failed Product,Ceramics,White,Stoneware,$10,https://x/hg-101.jpg,an idea,",
    ].join("\n") + "\n";
  const { rows } = parseCatalog(csvIn);
  await importCatalogRows(rows, noSuggest);
  const d = db();
  const batchId = d
    .prepare("insert into batches (kind) values ('product')")
    .run().lastInsertRowid;
  d.prepare(
    "insert into candidates (sku, batch_id, prompt, state) values ('HG-101', ?, 'p', 'failed')",
  ).run(batchId);

  const { productStatus } = await import("../lib/status.ts");
  const row = approvedByProduct().find((r) => r.p.sku === "HG-101");
  assert.equal(row?.status, productStatus(true, [{ state: "failed" }]));
  assert.equal(row?.status, "failed");
});

test("a shot idea that looks like a spreadsheet formula is neutralised and still round-trips", async () => {
  const formula = '=HYPERLINK("https://attacker.example","Open")';
  const csvIn =
    [
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
      `HG-102,Formula Product,Ceramics,White,Stoneware,$10,https://x/hg-102.jpg,"${formula.replace(/"/g, '""')}",+not a sum`,
    ].join("\n") + "\n";
  const { rows } = parseCatalog(csvIn);
  await importCatalogRows(rows, noSuggest);

  const out = exportCsv();
  const raw = parseCsv(out, { columns: true }) as Record<string, string>[];
  const cell = raw.find((r) => r.SKU === "HG-102");
  assert.ok(cell);
  assert.equal(cell["Shot Idea"][0], " ", "leading space defuses the formula");
  assert.equal(cell.Notes[0], " ");
  const { rows: back } = parseCatalog(out);
  const again = back.find((r) => r.sku === "HG-102");
  assert.equal(
    again?.shot_idea,
    formula,
    "importer trims it back to the original",
  );
  assert.equal(again?.notes, "+not a sum");
});

test("an image that vanishes between the plan and the stream fails the download instead of truncating it", async () => {
  const plan = exportZipPlan();
  const victim = plan.files[0];
  assert.ok(victim, "fixture has at least one planned file");
  const bytes = storage.readImage(victim.id);
  assert.ok(bytes);
  fs.unlinkSync(storage.imagePath(victim.id));
  try {
    await assert.rejects(
      () => new Response(exportZip(plan)).arrayBuffer(),
      /vanished mid-stream/,
    );
  } finally {
    storage.saveImage(victim.id, bytes); // put it back for the tests that follow
  }
});
