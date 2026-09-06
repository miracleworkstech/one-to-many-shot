// Performance JSON for whoever holds the team link (Task 22): the middleware matcher gates
// every path that is not _next, icon.svg or healthz, so this one is gated by construction.
// No parameters; nothing on the status page reads it.
import { performance } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(performance(), {
    headers: { "Cache-Control": "no-store" },
  });
}
