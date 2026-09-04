// The Drive hand-off (D3): a CSV Maya can open in Sheets, and a zip Ellie's approvals become
// deterministic files in. Both are derived from the same approvedByProduct() query.
import { stringify } from "csv-stringify/sync";
import { Zip, ZipPassThrough } from "fflate";
import { storage } from "./storage";
import { STATUS_LABEL } from "./status";
import { REQUIRED_HEADERS } from "./catalog";
import { approvedByProduct } from "./queries";
import { spendBySku } from "./analytics";
import { env } from "./env";

/**
 * Customer text opens in Sheets/Excel, where a cell starting with = + - @ runs as a formula
 * (CSV injection). A leading space neutralises it, and parseCatalog trims, so the export
 * still round-trips through the importer unchanged (Codex, Task 7).
 */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? ` ${s}` : s);

export function exportCsv(): string {
  const spend = spendBySku();
  const rows = approvedByProduct().map(({ p, approved, status }) => ({
    SKU: safe(p.sku),
    "Product Name": safe(p.name),
    Category: safe(p.category),
    "Color / Finish": safe(p.color),
    Material: safe(p.material),
    Price: safe(p.price),
    Photo: p.photo_url,
    "Shot Idea": safe(p.shot_idea ?? ""),
    Notes: safe(p.notes),
    Status: STATUS_LABEL[status],
    // Task 8 gates every route (including /img) behind a shared token. The whole team
    // already holds that token in their copy of the app link, so appending it here keeps
    // these links clickable instead of 401ing once that gate lands.
    "Approved Images": approved
      .map(
        (a) =>
          `${env.appUrl}/img/${a.c.id}${env.accessToken ? `?k=${env.accessToken}` : ""}`,
      )
      .join("; "),
    "Approved Filenames": approved.map((a) => a.name).join("; "),
    "Spent (USD)": (spend.get(p.sku) ?? 0).toFixed(2),
  }));
  return stringify(rows, {
    header: true,
    columns: [
      ...REQUIRED_HEADERS,
      "Status",
      "Approved Images",
      "Approved Filenames",
      "Spent (USD)",
    ],
  });
}

const MANIFEST = "manifest.csv";
export const ZIP_TOO_LARGE =
  "zip too large for a single archive (over 4 GB); export in parts";

export type ZipPlan = {
  files: { name: string; id: number; size: number }[];
  manifest: Uint8Array;
  contentLength: number;
};

/**
 * Exact byte size of the archive fflate 0.8.3 (pinned by package-lock.json) writes for stored
 * entries pushed through a streaming `Zip`. Per entry: a 30-byte local header + the UTF-8
 * name, the data, then a 16-byte data descriptor (node_modules/fflate/esm/index.mjs:2092
 * `hl = fl + exfl(extra) + 30`, :2138 the 16-byte `dd`). Then one 46-byte central-directory
 * entry + name each (:2185) and a 22-byte end-of-central-directory (:2187). ZipPassThrough
 * sets neither `extra` nor `comment`, so those are zero; the UTF-8 flag changes bits, not
 * lengths. The exportZip equality test is what pins this to that version, not this comment.
 */
export function zipSizeFor(
  entries: { nameBytes: number; size: number }[],
): number {
  const total = entries.reduce((n, e) => n + 92 + 2 * e.nameBytes + e.size, 22);
  // Every size and offset in the layout above is a 4-byte field and the entry count a
  // 2-byte one; past those we would need zip64. `total` exceeds any single entry's size,
  // so it covers both. Refuse rather than let fflate's wbytes wrap and hand out a corrupt
  // archive. (65535 entries is two orders of magnitude past this catalog.)
  if (total > 0xffffffff || entries.length > 0xffff)
    throw new Error(ZIP_TOO_LARGE);
  return total;
}

/** Everything the zip route needs before it streams: what goes in, and exactly how many
 *  bytes that will be. Stats each image once; exportZip(plan) reuses this, no double stat. */
export function exportZipPlan(): ZipPlan {
  const manifest = new TextEncoder().encode(exportCsv());
  const files = approvedByProduct()
    .flatMap(({ approved }) =>
      approved.map((a) => ({ name: a.name, id: a.c.id })),
    )
    .flatMap((f) => {
      // A candidate can be approved with its file missing on disk (storage wiped, moved
      // manually). Skip it in the zip but keep it in the manifest so the gap is visible
      // rather than silently dropped.
      const size = storage.imageSize(f.id);
      if (size === null) {
        console.warn(
          `export: approved candidate ${f.id} has no image file; left out of the zip`,
        );
        return [];
      }
      return [{ ...f, size }];
    });
  return {
    files,
    manifest,
    contentLength: zipSizeFor([
      { nameBytes: Buffer.byteLength(MANIFEST, "utf8"), size: manifest.length },
      // ASCII today (approvedFilename slugs to [A-Za-z0-9_-]), measured as UTF-8 anyway so
      // the arithmetic survives the day a name stops being ASCII.
      ...files.map((f) => ({
        nameBytes: Buffer.byteLength(f.name, "utf8"),
        size: f.size,
      })),
    ]),
  };
}

// ponytail: the ceiling is gone. Files stream through fflate's Zip one at a time, so peak
// memory is a small constant (a few images' worth: the read buffer, its copy, queued
// chunks) regardless of catalog size; measured 26 MB for a 120 MB zip. exportCsv() (the
// manifest) is still built up front as one string, fine at any plausible catalog size (D14).
export function exportZip(
  plan: ZipPlan = exportZipPlan(),
): ReadableStream<Uint8Array> {
  const { files, manifest } = plan;

  let zip: Zip;
  let manifestSent = false;
  let i = 0;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // level 0: JPEGs are already compressed, spend no CPU trying again. The Zip is built
      // here so its callback always has a controller: nothing can be swallowed.
      zip = new Zip((err, chunk) => {
        if (err) controller.error(err);
        else if (chunk) controller.enqueue(chunk);
      });
    },
    // One file per pull(): the image for the entry being written is the only one ever
    // held in memory, and a slow consumer's backpressure just stops us reading more
    // (the Streams spec never calls pull() again after cancel()).
    pull(controller) {
      if (!manifestSent) {
        manifestSent = true;
        const entry = new ZipPassThrough(MANIFEST);
        zip.add(entry);
        entry.push(manifest, true);
        return;
      }
      if (i < files.length) {
        const { name, id, size } = files[i++];
        const b = storage.readImage(id);
        // Content-Length already promised exactly `size` bytes for this entry. If the file
        // changed or vanished between the plan and this pull, a visibly failed download
        // beats a silently truncated one.
        if (!b || b.length !== size) {
          controller.error(
            new Error(`export: image ${id} changed or vanished mid-stream`),
          );
          return;
        }
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(new Uint8Array(b), true);
        return;
      }
      zip.end();
      controller.close();
    },
    cancel() {
      zip.terminate();
    },
  });
}
