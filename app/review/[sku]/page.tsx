import Link from "next/link";
import { notFound } from "next/navigation";
import { productDetail } from "@/lib/queries";
import { STATUS_LABEL } from "@/lib/status";
import type { Candidate, CandidateState } from "@/lib/types";
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
const DECIDED_DONE = { approved: "Approved", rejected: "Rejected" };
const DECIDED_FILL = {
  approved: "bg-green-700 text-white border-green-700",
  rejected: "bg-red-700 text-white border-red-700",
};

/** Reading order for the page, not the database: what Ellie still has to decide comes
 *  first, then what is on its way, then what she already decided, then what broke. */
const RANK: Record<CandidateState, number> = {
  completed: 0,
  processing: 1,
  queued: 1,
  approved: 2,
  rejected: 3,
  failed: 4,
};
const byReadingOrder = (a: Candidate, b: Candidate) =>
  RANK[a.state] - RANK[b.state] || b.id - a.id;

/** The photo host answered but refused us (lib/photos.ts). The fix is in the sheet, not here. */
const isPhotoProblem = (reason: string | null) => /photo/i.test(reason ?? "");

export default async function Review({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const detail = productDetail(sku);
  if (!detail) notFound();
  const { p, status, prev, next, position, total } = detail;
  const cands = [...detail.cands].sort(byReadingOrder);
  const perCost = env.candidatesPerProduct * env.costPerImage;
  const toDecide = cands.filter((c) => c.state === "completed").length;
  const canGenerate = !!p.shot_idea && status !== "generating";
  const canRetry =
    canGenerate &&
    cands.some((c) => c.state === "rejected" || c.state === "failed");
  const meta = [p.color, p.material, p.price].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-lg px-4 pt-2 pb-24 sm:pb-6">
      <header className="flex items-center justify-between gap-3 text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center underline">
          All products
        </Link>
        <p className="text-stone-600">
          <span className="rounded-full bg-stone-200/70 px-2 py-1 text-xs text-stone-800">
            {STATUS_LABEL[status]}
          </span>
          {toDecide > 0 && (
            <span className="ml-2 text-xs">{toDecide} to decide</span>
          )}
        </p>
      </header>

      <div className="mt-3">
        <h1 className="text-xl font-semibold leading-tight text-balance">
          {p.name}
        </h1>
        <p className="mt-0.5 text-sm text-stone-600">
          {p.sku}
          {meta && ` · ${meta}`}
        </p>
      </div>

      {/* The idea is the criterion Ellie judges against, so it reads as a caption. Editing
          is the exception and lives behind the disclosure; a product with no idea yet opens
          the form, because writing one is the only thing to do here. */}
      <section className="mt-3">
        {p.shot_idea && (
          <p className="text-base leading-snug text-stone-900 text-pretty">
            {p.shot_idea}
            {p.shot_idea_source === "suggested" && (
              <span className="ml-1 text-sm text-stone-600">(suggested)</span>
            )}
          </p>
        )}
        {p.notes && (
          <p className="mt-1 text-sm text-stone-700">Note: {p.notes}</p>
        )}
        <details className="mt-1 text-sm" open={!p.shot_idea}>
          <summary className="inline-flex min-h-10 cursor-pointer select-none items-center text-stone-700 underline">
            {p.shot_idea ? "Edit the idea" : "Write the shot idea"}
          </summary>
          {/* The keys keep no client state across products: a half-typed idea cannot follow
              Prev/Next onto the next SKU. IdeaForm re-syncs its textarea itself when the
              idea changes (see the component), because a remount would also discard "Saved". */}
          <IdeaForm
            key={p.sku}
            sku={p.sku}
            idea={p.shot_idea}
            source={p.shot_idea_source}
            onSave={updateIdea}
          />
        </details>
      </section>

      {/* Nothing to review yet: generating is the one thing to do, so it leads. Once
          candidates exist it moves below them as a quiet secondary action. */}
      {canGenerate && cands.length === 0 && (
        <div className="mt-6">
          <GenerateProductForm
            key={`${p.sku}:product`}
            sku={p.sku}
            kind="product"
            label={`Generate ${env.candidatesPerProduct} candidates`}
            costUsd={perCost}
            variant="primary"
          />
        </div>
      )}

      {cands.length > 0 && (
        <ul className="mt-6 space-y-8" aria-label="Candidate shots">
          {cands.map((c) => (
            <li key={c.id}>
              {c.state === "queued" || c.state === "processing" ? (
                <div
                  role="status"
                  className="rounded-lg bg-stone-200/60 px-4 py-10 text-center text-sm text-stone-700"
                >
                  Generating…
                  <span className="block text-xs text-stone-600">
                    {c.state === "queued" ? "queued" : "in progress"} · $
                    {c.cost_usd.toFixed(2)} committed
                  </span>
                </div>
              ) : c.state === "failed" ? (
                <div
                  role="status"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                >
                  <p>Failed: {c.failure_reason ?? "unknown reason"}</p>
                  <p className="mt-1 text-red-800">
                    {isPhotoProblem(c.failure_reason)
                      ? "Check the Photo link for this row in the sheet, re-import, then try again."
                      : "Try again below for a fresh set."}
                  </p>
                </div>
              ) : (
                <figure className="-mx-4 sm:mx-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by our own /img route from local disk; next/image would re-encode a file we already sized. */}
                  <img
                    src={`/img/${c.id}`}
                    alt={`${p.name}, candidate ${c.id}`}
                    className="block min-h-48 w-full bg-stone-200/60 sm:rounded-lg"
                  />
                </figure>
              )}
              {DECIDED.includes(c.state) && (
                <div className="mt-2 flex items-center gap-2">
                  {DECISIONS.map((s) => (
                    <form key={s} action={decide} className="flex-1">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="state" value={s} />
                      <button
                        aria-pressed={c.state === s}
                        aria-label={`${c.state === s ? DECIDED_DONE[s] : DECIDED_LABEL[s]}, candidate ${c.id}`}
                        className={`min-h-12 w-full rounded-lg border px-3 py-3 text-base font-medium transition-colors duration-150 ease-out motion-reduce:transition-none ${
                          c.state === s
                            ? DECIDED_FILL[s]
                            : "border-stone-300 bg-white text-stone-900 hover:bg-stone-100"
                        }`}
                      >
                        {c.state === s ? DECIDED_DONE[s] : DECIDED_LABEL[s]}
                      </button>
                    </form>
                  ))}
                </div>
              )}
              {c.decided_by && (
                <p className="mt-1.5 text-xs text-stone-600">
                  {c.state === "approved" ? "Approved" : "Rejected"} by{" "}
                  {c.decided_by}
                  {c.decided_at && (
                    <>
                      {" · "}
                      <time
                        dateTime={`${c.decided_at.replace(" ", "T")}Z`}
                        title={`${c.decided_at} UTC`}
                      >
                        {c.decided_at.slice(0, 10)}
                      </time>
                    </>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {cands.length > 0 && (canGenerate || canRetry) && (
        <section className="mt-8 space-y-3 border-t border-stone-200 pt-5">
          {canRetry && (
            <GenerateProductForm
              key={`${p.sku}:retry`}
              sku={p.sku}
              kind="retry"
              label="Try again"
              costUsd={perCost}
              variant="quiet"
            />
          )}
          {canGenerate && (
            <GenerateProductForm
              key={`${p.sku}:product`}
              sku={p.sku}
              kind="product"
              label={`Generate ${env.candidatesPerProduct} more`}
              costUsd={perCost}
              variant="quiet"
            />
          )}
        </section>
      )}

      <section className="mt-8 flex items-center gap-3 text-sm text-stone-600">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote host, no loader configured; next/image would need remotePatterns for an arbitrary customer CDN. */}
        <img
          src={p.photo_url}
          alt={`${p.name} product photo`}
          className="h-16 w-16 shrink-0 rounded bg-white object-cover"
        />
        <p>
          The product photo from the sheet, which every candidate starts from.
        </p>
      </section>

      <nav
        aria-label="Products"
        className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-stone-50/95 pb-[env(safe-area-inset-bottom)] sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:pb-0"
      >
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-1 text-sm sm:px-0">
          {prev ? (
            <Link
              href={`/review/${prev}`}
              className="inline-flex min-h-11 items-center underline"
            >
              Previous
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center text-stone-500">
              Previous
            </span>
          )}
          <span className="text-xs text-stone-600 tabular-nums">
            {position} of {total}
          </span>
          {next ? (
            <Link
              href={`/review/${next}`}
              className="inline-flex min-h-11 items-center underline"
            >
              Next
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center text-stone-500">
              Next
            </span>
          )}
        </div>
      </nav>
    </main>
  );
}
