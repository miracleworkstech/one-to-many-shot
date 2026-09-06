// The Slack deep link: land on the first product that needs a decision, or on the queue
// heading of the status page when nothing does. Gated by the middleware like every route.
import { nextToDecide } from "@/lib/queries";

export const dynamic = "force-dynamic";

export function GET() {
  const sku = nextToDecide();
  // A relative Location: Railway terminates TLS, so the request's own origin is the
  // container's internal http one; the browser resolves this against the URL it asked for.
  return new Response(null, {
    status: 302,
    headers: {
      Location: sku ? `/review/${sku}` : "/#decide",
      "Cache-Control": "no-store",
    },
  });
}
