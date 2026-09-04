import { exportCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  // The BOM makes Excel read UTF-8 (accented product names); parseCatalog strips it on re-import.
  return new Response(`﻿${exportCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="catalog-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
