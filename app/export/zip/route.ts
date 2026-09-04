import { exportZip } from "@/lib/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // the zip streams from the filesystem; documents the requirement

export async function GET() {
  return new Response(exportZip(), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="approved-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
