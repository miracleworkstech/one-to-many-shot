// The Drive hand-off (D3): a CSV Maya can open in Sheets, and a zip Ellie's approvals become
// deterministic files in. Both are derived from the same approvedByProduct() query.
import { stringify } from "csv-stringify/sync";
import { zipSync } from "fflate";
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

// ponytail: the whole zip is built in memory. Luma's 1:1 JPEGs run well under 1 MB, so
// 300 products x 3 approved is a few hundred MB at worst on a 2 GB box; fflate's streaming
// Zip class plus a ReadableStream response is the upgrade if the catalog outgrows that.
export function exportZip(): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { approved } of approvedByProduct())
    for (const a of approved) {
      // A candidate can be approved with its file missing on disk (storage wiped, moved
      // manually). Skip it in the zip but keep it in the manifest so the gap is visible
      // rather than silently dropped.
      const b = storage.readImage(a.c.id);
      if (b) files[a.name] = new Uint8Array(b);
      else
        console.warn(
          `export: approved candidate ${a.c.id} has no image file; left out of the zip`,
        );
    }
  files["manifest.csv"] = new TextEncoder().encode(exportCsv());
  // JPEGs are already compressed; spend no CPU trying again.
  return zipSync(files, { level: 0 });
}
