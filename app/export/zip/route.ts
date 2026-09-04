import { exportZip } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(new Uint8Array(exportZip()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="approved-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
