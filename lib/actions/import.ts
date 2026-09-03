"use server";
import { revalidatePath } from "next/cache";
import { parseCatalog } from "@/lib/catalog";
import { importCatalogRows } from "@/lib/import";

export async function importCatalog(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File))
    return { imported: 0, suggested: 0, errors: ["No file"] };
  const { rows, errors } = parseCatalog(await file.text());
  if (!rows.length) return { imported: 0, suggested: 0, errors };
  const { imported, suggested } = await importCatalogRows(rows);
  revalidatePath("/");
  return { imported, suggested, errors };
}
