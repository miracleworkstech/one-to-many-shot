import Link from "next/link";
import { notFound } from "next/navigation";
import { productDetail } from "@/lib/queries";
import { STATUS_LABEL } from "@/lib/status";
import type { CandidateState } from "@/lib/types";
import { env } from "@/lib/env";
import { decide, updateIdea } from "@/lib/actions/review";
import { DECISIONS } from "@/lib/review";
import { IdeaForm } from "@/components/IdeaForm";
import { GenerateProductForm } from "@/components/GenerateProductForm";

export const dynamic = "force-dynamic";

const DECIDED: readonly CandidateState[] = [
  "completed",
  "approved",
  "rejected",
];
const DECIDED_LABEL = { approved: "Approve", rejected: "Reject" };
const DECIDED_DONE = { approved: "Approved ✓", rejected: "Rejected ✓" };

export default async function Review({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const detail = productDetail(sku);
  if (!detail) notFound();
  const { p, cands, status, prev, next } = detail;
  const perCost = env.candidatesPerProduct * env.costPerImage;

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          All products
        </Link>
        <span className="rounded-full bg-stone-100 px-2 py-1 text-xs">
          {STATUS_LABEL[status]}
        </span>
        <div className="flex gap-4">
          {prev && (
            <Link
              href={`/review/${prev}`}
              className="inline-flex min-h-11 items-center underline"
            >
              Prev
            </Link>
          )}
          {next && (
            <Link
              href={`/review/${next}`}
              className="inline-flex min-h-11 items-center underline"
            >
              Next
            </Link>
          )}
        </div>
      </div>
      <h1 className="text-xl font-semibold">
        {p.sku} · {p.name}
      </h1>
      <div className="flex gap-3 text-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote host, no loader configured; next/image would need remotePatterns for an arbitrary customer CDN. */}
        <img
          src={p.photo_url}
          alt={`${p.name} product photo`}
          className="h-24 w-24 shrink-0 rounded bg-white object-cover"
        />
        <div className="min-w-0 text-stone-600">
          {[p.color, p.material, p.price].filter(Boolean).join(" · ")}
          {p.notes && (
            <div className="mt-1 text-xs italic">Notes: {p.notes}</div>
          )}
        </div>
      </div>
      {/* The keys keep no client state across products: a refusal, or a half-typed idea,
          cannot follow Prev/Next onto the next SKU. IdeaForm is keyed on the SKU alone and
          re-syncs the textarea itself when the idea changes (see the component), because a
          remount would also discard its "Saved" line. */}
      <IdeaForm
        key={p.sku}
        sku={p.sku}
        idea={p.shot_idea}
        source={p.shot_idea_source}
        onSave={updateIdea}
      />
      {p.shot_idea && status !== "generating" && (
        <GenerateProductForm
          key={`${p.sku}:product`}
          sku={p.sku}
          kind="product"
          label={
            cands.length
              ? `Generate ${env.candidatesPerProduct} more`
              : `Generate ${env.candidatesPerProduct} candidates`
          }
          costUsd={perCost}
        />
      )}
      <ul className="space-y-4">
        {cands.map((c) => (
          <li key={c.id} className="rounded bg-white p-2 shadow-sm">
            {c.state === "queued" || c.state === "processing" ? (
              <div
                role="status"
                className="p-6 text-center text-sm text-stone-500"
              >
                Generating… ({c.state === "queued" ? "queued" : "generating"}, $
                {c.cost_usd.toFixed(2)} committed)
              </div>
            ) : c.state === "failed" ? (
              <div role="status" className="p-3 text-sm text-red-700">
                Failed: {c.failure_reason ?? "unknown reason"}
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own /img route from local disk; next/image would re-encode a file we already sized.
              <img
                src={`/img/${c.id}`}
                alt={`${p.name}, candidate ${c.id}`}
                className="w-full rounded"
              />
            )}
            {DECIDED.includes(c.state) && (
              <div className="mt-2 flex items-center gap-2">
                {DECISIONS.map((s) => (
                  <form key={s} action={decide} className="flex-1">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="sku" value={sku} />
                    <input type="hidden" name="state" value={s} />
                    <button
                      className={`min-h-11 w-full rounded px-3 py-3 text-sm ${
                        c.state === s
                          ? s === "approved"
                            ? "bg-green-700 text-white"
                            : "bg-red-700 text-white"
                          : "bg-stone-100"
                      }`}
                    >
                      {c.state === s ? DECIDED_DONE[s] : DECIDED_LABEL[s]}
                    </button>
                  </form>
                ))}
              </div>
            )}
            {c.decided_by && (
              <div className="mt-1 text-xs text-stone-500">
                {c.state} by {c.decided_by}
                {c.decided_at && ` · ${c.decided_at} UTC`}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cands.some((c) => c.state === "rejected") && status !== "generating" && (
        <GenerateProductForm
          key={`${p.sku}:retry`}
          sku={p.sku}
          kind="retry"
          label="Try again"
          costUsd={perCost}
        />
      )}
    </main>
  );
}
