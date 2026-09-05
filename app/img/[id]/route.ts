// Auth: the shared-token middleware (Task 8) gates every route including this one; the
// numeric id is the whole path, so no traversal.
import { storage } from "@/lib/storage";
import { reviewVariant } from "@/lib/images";

/** Candidate images are private to the customer: no CDN, no shared cache. The page gets
 *  the review-size copy; the export (lib/export.ts) reads the original from disk. */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return new Response("not found", { status: 404 });
  let buf = storage.readReview(id);
  if (!buf) return new Response("not found", { status: 404 });
  // Candidates from before the review copy existed (or whose resize failed in the
  // worker) get it made here, once, on their first request. Two requests racing write
  // the same bytes; a resize that fails again serves the original and says so.
  if (!storage.hasReview(id)) {
    try {
      buf = await reviewVariant(buf);
      storage.saveReview(id, buf);
    } catch (e) {
      console.warn(
        `review copy for candidate ${id} not made, serving the original:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
