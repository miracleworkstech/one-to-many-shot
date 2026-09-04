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

// ponytail: the ceiling is gone. Files stream through fflate's Zip one at a time, so peak
// memory is a small constant (a few images' worth: the read buffer, its copy, queued
// chunks) regardless of catalog size; measured 26 MB for a 120 MB zip. exportCsv() (the
// manifest) is still built up front as one string, fine at any plausible catalog size (D14).
export function exportZip(): ReadableStream<Uint8Array> {
  const manifest = new TextEncoder().encode(exportCsv());
  const files = approvedByProduct().flatMap(({ approved }) =>
    approved.map((a) => ({ name: a.name, id: a.c.id })),
  );

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
        const entry = new ZipPassThrough("manifest.csv");
        zip.add(entry);
        entry.push(manifest, true);
        return;
      }
      while (i < files.length) {
        const { name, id } = files[i++];
        // A candidate can be approved with its file missing on disk (storage wiped, moved
        // manually). Skip it in the zip but keep it in the manifest so the gap is visible
        // rather than silently dropped.
        const b = storage.readImage(id);
        if (!b) {
          console.warn(
            `export: approved candidate ${id} has no image file; left out of the zip`,
          );
          continue;
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
