"use server";
import { revalidatePath } from "next/cache";
import { parseCatalog } from "@/lib/catalog";
import { importCatalogRows } from "@/lib/import";

// ponytail: a ~300-product export is under 100 KB; this caps a wrong-file upload
// (and the Haiku work it would trigger) without a row-count knob. Not exported:
// a "use server" file may only export async functions.
const MAX_CSV_BYTES = 2_000_000;

export async function importCatalog(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File))
    return { imported: 0, suggested: 0, errors: ["No file"] };
  if (file.size > MAX_CSV_BYTES)
    return {
      imported: 0,
      suggested: 0,
      errors: [`File is ${Math.round(file.size / 1e6)} MB; the limit is 2 MB`],
    };
  const { rows, errors } = parseCatalog(await file.text());
  if (!rows.length) return { imported: 0, suggested: 0, errors };
  const { imported, suggested } = await importCatalogRows(rows);
  revalidatePath("/");
  return { imported, suggested, errors };
}
