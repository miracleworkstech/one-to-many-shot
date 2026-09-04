import { parse } from "csv-parse/sync";
import { photoUrlProblem } from "./photos";

export const REQUIRED_HEADERS = [
  "SKU",
  "Product Name",
  "Category",
  "Color / Finish",
  "Material",
  "Price",
  "Photo",
  "Shot Idea",
  "Notes",
] as const;

export interface CatalogRow {
  sku: string;
  name: string;
  category: string;
  color: string;
  material: string;
  price: string;
  photo_url: string;
  shot_idea: string | null;
  notes: string;
  priority: boolean;
}

export const isPriority = (notes: string) =>
  /do this (one )?first/i.test(notes);

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

export function parseCatalog(text: string): {
  rows: CatalogRow[];
  errors: string[];
} {
  const errors: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(text.replace(/^\uFEFF/, ""), {
      columns: (h: string[]) => h.map(norm),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e) {
    return {
      rows: [],
      errors: [
        `Could not parse CSV: ${e instanceof Error ? e.message : String(e)}`,
      ],
    };
  }
  const present = new Set(Object.keys(records[0] ?? {}));
  const missing = REQUIRED_HEADERS.filter((h) => !present.has(norm(h)));
  if (missing.length)
    return {
      rows: [],
      errors: [
        `Missing columns: ${missing.join(", ")}. Expected: ${REQUIRED_HEADERS.join(", ")}`,
      ],
    };

  const bySku = new Map<string, CatalogRow>();
  records.forEach((r, i) => {
    const g = (h: string) => (r[norm(h)] ?? "").trim();
    const sku = g("SKU").toUpperCase();
    if (!sku) {
      errors.push(`Row ${i + 2}: empty SKU, skipped`);
      return;
    }
    const photoProblem = photoUrlProblem(g("Photo"));
    if (photoProblem) {
      errors.push(`Row ${i + 2} (${sku}): Photo ${photoProblem}, skipped`);
      return;
    }
    if (bySku.has(sku))
      errors.push(`Row ${i + 2}: duplicate SKU ${sku}, last one wins`);
    const notes = g("Notes");
    bySku.set(sku, {
      sku,
      name: g("Product Name"),
      category: g("Category"),
      color: g("Color / Finish"),
      material: g("Material"),
      price: g("Price"),
      photo_url: g("Photo"),
      shot_idea: g("Shot Idea") || null,
      notes,
      priority: isPriority(notes),
    });
  });
  return { rows: [...bySku.values()], errors };
}
