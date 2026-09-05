import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { productDetail } from "@/lib/queries";
import {
  STATUS_LABEL,
  STATUS_TONE,
  byReadingOrder,
  canRetry as retryAllowed,
  carouselEnd,
  friendlyFailure,
  isPhotoProblem,
  needsNewIdea,
  shortDate,
} from "@/lib/status";
import { env } from "@/lib/env";
import { decide, updateIdea } from "@/lib/actions/review";
import { IdeaForm } from "@/components/IdeaForm";
import { StateDot as Dot } from "@/components/StateDot";
import { GenerateProductForm } from "@/components/GenerateProductForm";
import { PRIMARY, QUIET } from "@/components/buttons";

export const dynamic = "force-dynamic";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

export default async function Review({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const detail = productDetail(sku);
  if (!detail) notFound();
  const { p, status, prev, next, position, total } = detail;
  const all = [...detail.cands].sort(byReadingOrder);
  // Rejections leave the carousel for a folded grid below it: the carousel is for what is
  // still worth a look, the grid is the record. Both still count for status and spend.
  const rejected = all.filter((c) => c.state === "rejected");
  const cands = all.filter((c) => c.state !== "rejected");
  const toDecide = cands.filter((c) => c.state === "completed").length;
  const canGenerate = !!p.shot_idea && status !== "generating";
  const canRetry = !!p.shot_idea && retryAllowed(all, status);
  // The end card closes the carousel once nothing is undecided or in flight (lib/status.ts).
  const end = p.shot_idea ? carouselEnd(all, status) : null;
  const meta = [p.color, p.material, p.price].filter(Boolean).join(" · ");
  const slides = cands.length + (end ? 1 : 0);
  const ideaNudge = needsNewIdea(rejected.length, env.candidatesPerProduct);

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
        <p className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 font-medium text-stone-900">
            <Dot tone={STATUS_TONE[status]} />
            {STATUS_LABEL[status]}
          </span>
          {toDecide > 0 && (
            <span className="text-stone-600 tabular-nums">
              {toDecide} to decide
            </span>
          )}
        </p>
        {(canGenerate || canRetry) && all.length > 0 ? (
          <>
            <button
              type="button"
              popoverTarget="more"
              aria-label="More options"
              className="inline-flex size-11 items-center justify-center rounded-lg text-stone-900 hover:bg-stone-100 [anchor-name:--sheet]"
            >
              <MoreHorizontal {...ICON} />
            </button>
            {/* Follow-ups live here, hidden during review: the next set, or a change of
                direction. The end card surfaces the same actions when they are the next step. */}
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
        ) : (
          <span className="size-11" aria-hidden="true" />
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
          in place (IdeaForm); the pencil is a label for the textarea, so tapping it edits. */}
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
        <label
          htmlFor="idea"
          title="Edit the shot idea"
          className="inline-flex size-11 shrink-0 cursor-text items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        >
          <Pencil {...ICON} />
          <span className="sr-only">Edit the shot idea</span>
        </label>
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
      {canGenerate && all.length === 0 && (
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

      {(cands.length > 0 || end) && (
        <ul
          aria-label="Candidate shots, scroll sideways for more"
          tabIndex={0}
          className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-px-4 [scrollbar-width:none]"
        >
          {cands.map((c, i) => (
            <li
              key={c.id}
              className="w-[88%] shrink-0 snap-start sm:w-full"
              aria-label={`Slide ${i + 1} of ${slides}`}
            >
              <div className="relative">
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
                    className="flex aspect-[4/5] max-h-[60svh] flex-col justify-center rounded-lg border border-clay/30 bg-clay-tint p-5 text-sm text-stone-900"
                  >
                    <p className="inline-flex items-center gap-1.5 font-medium">
                      <Dot tone="stop" />
                      This one didn&apos;t come out
                    </p>
                    <p className="mt-1">{friendlyFailure(c.failure_reason)}</p>
                    <p className="mt-2 text-stone-700">
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
                <span className="absolute top-2 left-2 rounded-full bg-stone-900/70 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
                  {i + 1}/{slides}
                </span>
              </div>

              {c.state === "completed" && (
                <div className="mx-auto mt-3 flex max-w-xs gap-2">
                  {(["approved", "rejected"] as const).map((s) => (
                    <form key={s} action={decide} className="flex-1">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="state" value={s} />
                      <button
                        aria-label={`${s === "approved" ? "Approve" : "Reject"}, slide ${i + 1}`}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-900 transition-colors duration-150 ease-out hover:bg-stone-100 active:bg-stone-200 motion-reduce:transition-none"
                      >
                        {s === "approved" ? "Approve" : "Reject"}
                      </button>
                    </form>
                  ))}
                </div>
              )}

              {/* Approved: the state is the loud thing, the way to change it is quiet. */}
              {c.state === "approved" && (
                <div className="mt-3 flex flex-col items-center gap-2 text-center">
                  <p
                    className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-stone-900"
                    aria-label={`Approved, slide ${i + 1}`}
                  >
                    <Dot tone="ok" />
                    Approved
                    {c.decided_at && (
                      <>
                        <span aria-hidden="true">·</span>
                        <time
                          dateTime={`${c.decided_at.replace(" ", "T")}Z`}
                          title={`${c.decided_at} UTC`}
                          className="font-normal"
                        >
                          {shortDate(c.decided_at)}
                        </time>
                      </>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <form action={decide}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="sku" value={sku} />
                      <input type="hidden" name="state" value="rejected" />
                      <button
                        className={QUIET}
                        aria-label={`Reject slide ${i + 1}`}
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
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
                    <p className="inline-flex items-center gap-2 font-semibold text-stone-900">
                      <Check {...ICON} className="text-moss" />
                      Done · {end.approved} approved
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      These go into the next export.
                    </p>
                    <div className="mt-4 space-y-2">
                      {next && (
                        <Link href={`/review/${next}`} className={PRIMARY}>
                          Next product
                          <ChevronRight {...ICON} />
                        </Link>
                      )}
                      <GenerateProductForm
                        key={`${p.sku}:end-more`}
                        sku={p.sku}
                        kind="product"
                        label={`Generate ${env.candidatesPerProduct} more`}
                        variant="quiet"
                      />
                    </div>
                  </>
                ) : end.kind === "photo" ? (
                  <>
                    <p className="font-semibold">Nothing to review yet</p>
                    <p className="mt-1 text-sm text-stone-700">
                      We couldn&apos;t fetch the product photo. Fix the Photo
                      link for this row in the sheet, then re-import; the next
                      batch picks it up.
                    </p>
                    <div className="mt-4 space-y-2">
                      <Link href="/" className={PRIMARY}>
                        Go to import
                        <ChevronRight {...ICON} />
                      </Link>
                      <GenerateProductForm
                        key={`${p.sku}:end-more`}
                        sku={p.sku}
                        kind="product"
                        label={`Generate ${env.candidatesPerProduct} more`}
                        variant="quiet"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">
                      {end.approved === 0
                        ? "Nothing approved yet"
                        : `${end.approved} approved so far`}
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      {end.kind === "retry"
                        ? "Say what should change, or ask for another set."
                        : "Ask for another set."}
                    </p>
                    <div className="mt-4 space-y-2">
                      {end.kind === "retry" && (
                        <GenerateProductForm
                          key={`${p.sku}:end-retry`}
                          sku={p.sku}
                          kind="retry"
                          label="Try again"
                          variant="primary"
                        />
                      )}
                      <GenerateProductForm
                        key={`${p.sku}:end-more`}
                        sku={p.sku}
                        kind="product"
                        label={`Generate ${env.candidatesPerProduct} more`}
                        variant={end.kind === "retry" ? "quiet" : "primary"}
                      />
                    </div>
                  </>
                )}
                {ideaNudge && end.kind !== "done" && (
                  <p className="mt-3 inline-flex items-start gap-1.5 text-sm font-medium text-stone-900">
                    <Dot tone="wait" />
                    <span>
                      {rejected.length} rejected so far. Change the idea above
                      before asking for another set.
                    </span>
                  </p>
                )}
              </div>
            </li>
          )}
        </ul>
      )}

      {/* The record of what was turned down: folded, wrapping, scales to dozens. */}
      {rejected.length > 0 && (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center gap-1 rounded-lg px-1 text-sm font-medium text-stone-700 hover:bg-stone-100">
            <ChevronRight
              {...ICON}
              className="chevron transition-transform duration-150 ease-out motion-reduce:transition-none"
            />
            {rejected.length} rejected
          </summary>
          <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
            {rejected.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  popoverTarget={`rejected-${c.id}`}
                  aria-label={`Rejected ${i + 1} of ${rejected.length}, look closer`}
                  className="block w-full rounded-lg hover:opacity-90"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by our own /img route from local disk. */}
                  <img
                    src={`/img/${c.id}`}
                    alt=""
                    className="aspect-[4/5] w-full rounded-lg bg-stone-200/60 object-cover"
                  />
                </button>
                {/* The action lives here, not under every thumbnail: it appears only when
                    someone chooses to look at this one. Tap outside or Escape closes. */}
                <div
                  id={`rejected-${c.id}`}
                  popover="auto"
                  className="lightbox"
                  aria-label={`Rejected ${i + 1} of ${rejected.length}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by our own /img route from local disk. */}
                  <img
                    src={`/img/${c.id}`}
                    alt={`${p.name}: ${p.shot_idea ?? "candidate shot"}`}
                    className="block max-h-[70svh] w-full rounded-lg bg-stone-200/60 object-contain"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-stone-900">
                      <Dot tone="stop" />
                      Rejected
                      {c.decided_at && (
                        <>
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={`${c.decided_at.replace(" ", "T")}Z`}
                            title={`${c.decided_at} UTC`}
                            className="font-normal"
                          >
                            {shortDate(c.decided_at)}
                          </time>
                        </>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <form action={decide}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="sku" value={sku} />
                        <input type="hidden" name="state" value="approved" />
                        <button className={QUIET}>Approve</button>
                      </form>
                      <button
                        type="button"
                        popoverTarget={`rejected-${c.id}`}
                        popoverTargetAction="hide"
                        className={QUIET}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
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
