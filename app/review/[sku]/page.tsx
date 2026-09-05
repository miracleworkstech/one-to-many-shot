import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  X,
} from "lucide-react";
import { productDetail } from "@/lib/queries";
import {
  STATUS_LABEL,
  DONE_AT,
  byReadingOrder,
  canRetry as retryAllowed,
  isPhotoProblem,
  carouselEnd,
} from "@/lib/status";
import type { CandidateState } from "@/lib/types";
import { env } from "@/lib/env";
import { decide, updateIdea } from "@/lib/actions/review";
import { DECISIONS } from "@/lib/review";
import { IdeaForm } from "@/components/IdeaForm";
import { GenerateProductForm } from "@/components/GenerateProductForm";

export const dynamic = "force-dynamic";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

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

/** "4 Sep" from SQLite's `datetime('now')` (UTC); the full stamp goes in the title. */
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const shortDate = (sqlite: string) =>
  `${Number(sqlite.slice(8, 10))} ${MONTHS[Number(sqlite.slice(5, 7)) - 1]}`;

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
  const toDecide = cands.filter((c) => c.state === "completed").length;
  const canGenerate = !!p.shot_idea && status !== "generating";
  const canRetry = !!p.shot_idea && retryAllowed(cands, status);
  // The end card closes the carousel once nothing is undecided or in flight (lib/status.ts).
  const end = p.shot_idea ? carouselEnd(cands, status) : null;
  const meta = [p.color, p.material, p.price].filter(Boolean).join(" · ");
  const slides = cands.length + (end ? 1 : 0);

  return (
    <main className="mx-auto max-w-lg px-4 pt-2 pb-20 sm:pb-6">
      <header className="flex items-center justify-between gap-2 text-sm">
        <Link
          href="/"
          aria-label="All products"
          className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-lg font-medium text-stone-900 hover:bg-stone-100 sm:pr-2"
        >
          <ArrowLeft {...ICON} />
          <span className="hidden sm:inline">All products</span>
        </Link>
        <p className="flex min-w-0 items-center gap-2 text-xs whitespace-nowrap">
          <span className="rounded-full bg-stone-200/70 px-2 py-1 text-stone-800">
            {STATUS_LABEL[status]}
          </span>
          {toDecide > 0 && (
            <span className="font-medium text-amber-800 tabular-nums">
              {toDecide} to decide
            </span>
          )}
        </p>
        {(canGenerate || canRetry) && cands.length > 0 && (
          <>
            <button
              type="button"
              popoverTarget="more"
              aria-label="More options"
              className="inline-flex size-11 items-center justify-center rounded-lg text-stone-900 hover:bg-stone-100 [anchor-name:--more]"
            >
              <MoreHorizontal {...ICON} />
            </button>
            {/* Follow-ups live here, hidden during review: the next set, or a change of
                direction. The end card surfaces Try again inline when it is the next step. */}
            <div id="more" popover="auto" className="sheet space-y-4 text-sm">
              {canRetry && (
                <GenerateProductForm
                  key={`${p.sku}:retry`}
                  sku={p.sku}
                  kind="retry"
                  label="Try again"
                  variant="quiet"
                />
              )}
              {canGenerate && (
                <GenerateProductForm
                  key={`${p.sku}:product`}
                  sku={p.sku}
                  kind="product"
                  label={`Generate ${env.candidatesPerProduct} more`}
                  variant="quiet"
                />
              )}
            </div>
          </>
        )}
      </header>

      <div className="mt-2">
        <h1 className="text-xl font-semibold leading-tight text-balance">
          {p.name}
        </h1>
        <p className="mt-0.5 text-sm text-stone-600">
          {p.sku}
          {meta && ` · ${meta}`}
        </p>
      </div>

      {/* Pinned context: the two things every candidate is judged against, the source
          photo and the idea, stay on screen through the whole carousel. The idea is edited
          in place (IdeaForm), so it is never shown twice. */}
      <section
        aria-label="Shot idea"
        className="sticky top-0 z-10 -mx-4 mt-3 flex items-start gap-3 border-b border-stone-300 bg-stone-50/95 px-4 py-2 backdrop-blur-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote host, no loader configured; next/image would need remotePatterns for an arbitrary customer CDN. */}
        <img
          src={p.photo_url}
          alt={`${p.name}, the product photo from the sheet`}
          width={48}
          height={48}
          className="mt-0.5 size-12 shrink-0 rounded-lg bg-white object-cover"
        />
        <IdeaForm
          key={p.sku}
          sku={p.sku}
          idea={p.shot_idea}
          source={p.shot_idea_source}
          onSave={updateIdea}
        />
      </section>
      {p.notes && (
        <p className="mt-2 text-sm text-stone-700">
          Note from the sheet: {p.notes}
        </p>
      )}

      {cands.length > 0 && (
        <p role="status" className="sr-only">
          {toDecide === 0 ? "Nothing left to decide" : `${toDecide} to decide`}
        </p>
      )}

      {/* Nothing to review yet: generating is the one thing to do, so it leads. */}
      {canGenerate && cands.length === 0 && (
        <div className="mt-6">
          <GenerateProductForm
            key={`${p.sku}:product`}
            sku={p.sku}
            kind="product"
            label={`Generate ${env.candidatesPerProduct} candidates`}
            variant="primary"
          />
        </div>
      )}

      {cands.length > 0 && (
        <ul
          aria-label="Candidate shots, scroll sideways for more"
          tabIndex={0}
          className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-px-4 [scrollbar-width:none]"
        >
          {cands.map((c, i) => (
            <li
              key={c.id}
              className="w-[88%] shrink-0 snap-start sm:w-full"
              aria-label={`Candidate ${i + 1} of ${slides}`}
            >
              {c.state === "queued" || c.state === "processing" ? (
                <div
                  role="status"
                  className="flex aspect-[4/5] max-h-[60svh] items-center justify-center rounded-lg bg-stone-200/60 px-4 text-center text-sm text-stone-700"
                >
                  Generating…
                </div>
              ) : c.state === "failed" ? (
                <div
                  role="status"
                  className="flex aspect-[4/5] max-h-[60svh] flex-col justify-center rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
                >
                  <p className="font-medium">Failed</p>
                  <p className="mt-1">{c.failure_reason ?? "unknown reason"}</p>
                  <p className="mt-2 text-red-800">
                    {isPhotoProblem(c.failure_reason) ? (
                      <>
                        Fix the Photo link for this row in the sheet, then{" "}
                        <Link
                          href="/"
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          re-import
                        </Link>
                        .
                      </>
                    ) : status === "generating" ? (
                      "Wait for the one in progress, then try again."
                    ) : (
                      "Try again for a fresh set."
                    )}
                  </p>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- served by our own /img route from local disk; next/image would re-encode a file we already sized.
                <img
                  src={`/img/${c.id}`}
                  alt={`${p.name}: ${p.shot_idea ?? "candidate shot"}`}
                  className="block max-h-[60svh] w-full rounded-lg bg-stone-200/60 object-contain"
                />
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="w-10 shrink-0 text-xs text-stone-600 tabular-nums">
                  {i + 1}/{slides}
                </span>
                {DECIDED.includes(c.state) &&
                  DECISIONS.map((s) => (
                    <form key={s} action={decide} className="flex-1">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="state" value={s} />
                      <button
                        aria-pressed={c.state === s}
                        aria-label={`${c.state === s ? DECIDED_DONE[s] : DECIDED_LABEL[s]}, candidate ${i + 1}`}
                        className={`inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors duration-150 ease-out active:bg-stone-200 motion-reduce:transition-none ${
                          c.state === s
                            ? DECIDED_FILL[s]
                            : "border-stone-300 bg-white text-stone-900 hover:bg-stone-100"
                        }`}
                      >
                        {c.state === s &&
                          (s === "approved" ? (
                            <Check {...ICON} />
                          ) : (
                            <X {...ICON} />
                          ))}
                        {c.state === s ? DECIDED_DONE[s] : DECIDED_LABEL[s]}
                      </button>
                    </form>
                  ))}
              </div>
              {c.decided_at && (
                <p className="mt-1 pl-10 text-xs text-stone-600">
                  {c.state === "approved" ? "Approved" : "Rejected"}
                  {" · "}
                  <time
                    dateTime={`${c.decided_at.replace(" ", "T")}Z`}
                    title={`${c.decided_at} UTC`}
                  >
                    {shortDate(c.decided_at)}
                  </time>
                </p>
              )}
            </li>
          ))}
          {end && (
            <li
              className="w-[88%] shrink-0 snap-start sm:w-full"
              aria-label={`End, ${slides} of ${slides}`}
            >
              <div className="flex aspect-[4/5] max-h-[60svh] flex-col justify-center rounded-lg border border-stone-300 bg-white p-5 text-base">
                {end.kind === "done" ? (
                  <>
                    <p className="inline-flex items-center gap-2 font-semibold text-green-800">
                      <Check {...ICON} />
                      Done · {end.approved} approved
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      These go into the next export.
                    </p>
                    {next && (
                      <Link
                        href={`/review/${next}`}
                        className="mt-4 inline-flex min-h-12 items-center justify-center gap-1 rounded-lg bg-stone-900 px-4 font-medium text-white hover:bg-stone-800"
                      >
                        Next product
                        <ChevronRight {...ICON} />
                      </Link>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold">
                      {end.approved === 0
                        ? "Nothing approved yet"
                        : `${end.approved} approved, ${DONE_AT} needed`}
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      {end.kind === "retry"
                        ? "Say what should change and ask for another set."
                        : "Ask for another set."}
                    </p>
                    <div className="mt-4">
                      {end.kind === "retry" ? (
                        <GenerateProductForm
                          key={`${p.sku}:end-retry`}
                          sku={p.sku}
                          kind="retry"
                          label="Try again"
                          variant="primary"
                        />
                      ) : (
                        <GenerateProductForm
                          key={`${p.sku}:end-more`}
                          sku={p.sku}
                          kind="product"
                          label={`Generate ${env.candidatesPerProduct} more`}
                          variant="primary"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
              <p className="mt-2 w-10 text-xs text-stone-600 tabular-nums">
                {slides}/{slides}
              </p>
            </li>
          )}
        </ul>
      )}

      <nav
        aria-label="Products"
        className="fixed inset-x-0 bottom-0 border-t border-stone-300 bg-stone-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:static sm:mt-8 sm:border-0 sm:bg-transparent sm:pb-0 sm:backdrop-blur-none"
      >
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-2 py-1 text-sm sm:px-0">
          {prev ? (
            <Link
              href={`/review/${prev}`}
              className="inline-flex min-h-11 min-w-24 items-center gap-1 rounded-lg px-2 font-medium text-stone-900 hover:bg-stone-100"
            >
              <ChevronLeft {...ICON} />
              Previous
            </Link>
          ) : (
            <span className="inline-flex min-h-11 min-w-24 items-center gap-1 px-2 text-stone-500">
              <ChevronLeft {...ICON} />
              Previous
            </span>
          )}
          <span className="text-xs text-stone-600 tabular-nums">
            {position} of {total}
          </span>
          {next ? (
            <Link
              href={`/review/${next}`}
              className="inline-flex min-h-11 min-w-24 items-center justify-end gap-1 rounded-lg px-2 font-medium text-stone-900 hover:bg-stone-100"
            >
              Next
              <ChevronRight {...ICON} />
            </Link>
          ) : (
            <span className="inline-flex min-h-11 min-w-24 items-center justify-end gap-1 px-2 text-stone-500">
              Next
              <ChevronRight {...ICON} />
            </span>
          )}
        </div>
      </nav>
    </main>
  );
}
