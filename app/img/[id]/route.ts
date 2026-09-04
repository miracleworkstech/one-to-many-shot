// Auth: the shared-token middleware (Task 8) gates every route including this one; the
// numeric id is the whole path, so no traversal.
import { storage } from "@/lib/storage";

/** Candidate images are private to the customer: no CDN, no shared cache. */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return new Response("not found", { status: 404 });
  const buf = storage.readImage(id);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
