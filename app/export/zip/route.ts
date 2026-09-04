import {
  exportZip,
  exportZipPlan,
  ZIP_TOO_LARGE,
  type ZipPlan,
} from "@/lib/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // the zip streams from the filesystem; documents the requirement

export async function GET() {
  // Planned first so Content-Length is exact: the browser gets a real progress bar instead
  // of a chunked download of unknown length. The same plan is what streams, no double stat.
  let plan: ZipPlan;
  try {
    plan = exportZipPlan();
  } catch (e) {
    if (e instanceof Error && e.message === ZIP_TOO_LARGE)
      return new Response(ZIP_TOO_LARGE, { status: 413 });
    throw e;
  }
  return new Response(exportZip(plan), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(plan.contentLength),
      "Content-Disposition": `attachment; filename="approved-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
