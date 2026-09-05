import Link from "next/link";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { overview } from "@/lib/queries";
import { recentBatches, spendSummary } from "@/lib/analytics";
import {
  DONE_AT,
  STATUS_LABEL,
  STATUS_TONE,
  shortDate,
  type ProductStatus,
} from "@/lib/status";
import type { Product } from "@/lib/types";
import { ImportForm } from "@/components/ImportForm";
import { GenerateForm } from "@/components/GenerateForm";
import { StateDot } from "@/components/StateDot";
import { resumeWorker } from "@/lib/actions/generate";
import { env } from "@/lib/env";
import { PRIMARY, QUIET } from "@/components/buttons";

export const dynamic = "force-dynamic";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** The page has three zones in reading order: what needs a person, what the machine is
 *  doing (Generate, then the passive states folded), and what comes out (approved images,
 *  Done). Not the enum's order, which is the lifecycle. */
const PASSIVE: readonly ProductStatus[] = [
  "idea_ready",
  "generating",
  "failed",
  "no_idea",
];
/** Rows shown before a list folds the rest. A 40-product drop fits; 300 done do not. */
const PAGE = 12;

const usd = (n: number) => `$${n.toFixed(2)}`;

type Row = {
  p: Product;
  status: ProductStatus;
  toDecide: number;
  approved: number;
};

/** Anything a reviewer can act on, whatever the lifecycle status says: a product with a
 *  second batch in flight still has its first candidates to decide, and a done product
 *  with a spare finished candidate still owes a decision on money already spent. */
const needsDecision = (r: Row) => r.toDecide > 0 || r.status === "needs_more";

/** The one fact a row carries beside the name: what is waiting on the reviewer, or how
 *  far the product is from done. Nothing for the passive states; the name is enough. */
function fact(r: Row): string | null {
  if (r.toDecide > 0) return `${r.toDecide} to decide`;
  if (r.status === "needs_more")
    return `${r.approved} of ${DONE_AT} approved · try again`;
  return null;
}

function Item(r: Row) {
  const f = fact(r);
  return (
    <li>
      <Link
        href={`/review/${r.p.sku}`}
        className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 hover:bg-stone-100 active:bg-stone-200 transition-colors duration-150 ease-out motion-reduce:transition-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.p.name}</span>
          <span className="block text-xs text-stone-600 tabular-nums">
            {r.p.sku}
          </span>
        </span>
        {f && (
          <span className="shrink-0 text-sm text-stone-700 tabular-nums">
            {f}
          </span>
        )}
        <ChevronRight {...ICON} className="shrink-0 text-stone-400" />
      </Link>
    </li>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  const head = rows.slice(0, PAGE);
  const rest = rows.slice(PAGE);
  return (
    <>
      <ul className="divide-y divide-stone-200">
        {head.map((r) => (
          <Item key={r.p.sku} {...r} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center gap-1 rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
            <ChevronDown {...ICON} className="chevron" />
            Show {rest.length} more
          </summary>
          <ul className="divide-y divide-stone-200">
            {rest.map((r) => (
              <Item key={r.p.sku} {...r} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** A folded list for a state nobody has to act on: one line with a dot and a count,
 *  the rows behind a chevron. Closed by default; the count is the information. */
function Folded({ status, rows }: { status: ProductStatus; rows: Row[] }) {
  return (
    <details className="border-t border-stone-200">
      <summary className="flex min-h-11 cursor-pointer select-none items-center rounded-lg px-2 hover:bg-stone-100">
        <h2 className="flex flex-1 items-center gap-2 text-sm font-medium text-stone-800">
          <ChevronDown {...ICON} className="chevron text-stone-500" />
          <StateDot tone={STATUS_TONE[status]} />
          <span className="flex-1">{STATUS_LABEL[status]}</span>
          <span className="text-stone-600 tabular-nums">
            <span className="sr-only">, </span>
            {rows.length}
          </span>
        </h2>
      </summary>
      <div className="pb-2">
        <Rows rows={rows} />
      </div>
    </details>
  );
}

export default function Home() {
  const { rows, pausedReason } = overview();
  const spend = spendSummary();
  const batches = recentBatches(5);
  const total = rows.length;
  const queue = rows.filter(needsDecision);
  // Every row lands in exactly one list: the queue wins over Done and the passive states.
  const done = rows.filter((r) => r.status === "done" && !needsDecision(r));
  const byStatus = new Map<ProductStatus, Row[]>();
  for (const r of rows)
    if (!needsDecision(r) && r.status !== "done")
      byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);
  const ready = byStatus.get("idea_ready") ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 pt-3 pb-10">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">Styled shots</h1>
        {total > 0 && (
          <div className="ml-auto flex items-center gap-2 [anchor-name:--sheet]">
            <ImportForm />
            <button
              type="button"
              popoverTarget="spend"
              className={`${QUIET} tabular-nums`}
            >
              {usd(spend.spent)} spent
              <ChevronDown {...ICON} className="text-stone-500" />
            </button>
            {/* Spend is a bound, not a receipt: total first, the rest as prose, one tap
                away from the running total in the header (D20, amended). */}
            <div
              id="spend"
              popover="auto"
              className="sheet space-y-2 text-sm text-stone-800"
            >
              <p className="text-base font-semibold text-stone-900 tabular-nums">
                {usd(spend.spent)} spent of {usd(env.maxTotalSpend)}
              </p>
              <p className="tabular-nums">
                {usd(spend.spentApproved)} on approved images,{" "}
                {usd(spend.spentWasted)} on rejected or failed
                {spend.spentPending > 0 &&
                  `, ${usd(spend.spentPending)} still being decided`}
                .
              </p>
              {spend.costPerApproved != null && (
                <p className="tabular-nums">
                  About {usd(spend.costPerApproved)} per approved image
                  {spend.approvalRate != null &&
                    `, ${Math.round(spend.approvalRate * 100)}% of decisions approve`}
                  .
                </p>
              )}
              {batches.length > 0 && (
                <ul className="divide-y divide-stone-200 border-t border-stone-200 pt-1 text-stone-700">
                  {batches.map((b) => (
                    <li key={b.id} className="flex gap-3 py-1.5 tabular-nums">
                      <time
                        dateTime={`${b.created_at.replace(" ", "T")}Z`}
                        title={`${b.created_at} UTC`}
                        className="w-14 shrink-0"
                      >
                        {shortDate(b.created_at)}
                      </time>
                      <span>
                        {b.images} {b.images === 1 ? "image" : "images"} ·{" "}
                        {usd(b.actual_usd)} · {b.approved} approved
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </header>
      {total > 0 && (
        <p className="mt-3 font-medium text-stone-900 tabular-nums">
          {done.length} of {total} done
          {queue.length > 0 && (
            <>
              {" · "}
              <a
                href="#decide"
                className="-my-3 py-3 underline-offset-4 hover:underline"
              >
                {queue.length} {queue.length === 1 ? "needs" : "need"} a
                decision
              </a>
            </>
          )}
        </p>
      )}

      {pausedReason && (
        <div className="mt-4 rounded-lg border border-ochre/40 bg-ochre-tint p-3 text-sm text-stone-900">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <StateDot tone="wait" />
            Generation paused
          </p>
          <p className="mt-1">{pausedReason}</p>
          <form action={resumeWorker} className="mt-2">
            <button className="min-h-11 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800">
              Resume generation
            </button>
          </form>
        </div>
      )}

      {total === 0 ? (
        <section className="mt-6">
          <p className="text-sm text-stone-700">
            No products yet. Import the export from the sheet to start.
          </p>
          <div className="mt-3">
            <ImportForm variant="primary" />
          </div>
        </section>
      ) : (
        <>
          {/* Zone 1: the reviewer's queue is the page, never a disclosure. */}
          <section id="decide" className="mt-8">
            <h2 className="flex items-center gap-2 px-2 text-base font-semibold text-stone-900">
              <StateDot tone="wait" />
              Needs a decision
              <span className="text-sm font-normal text-stone-600 tabular-nums">
                <span className="sr-only">, </span>
                {queue.length}
              </span>
            </h2>
            <div className="mt-2 border-t border-stone-300">
              {queue.length > 0 ? (
                <Rows rows={queue} />
              ) : (
                <p className="px-2 py-3 text-sm text-stone-600">
                  Nothing needs a decision right now.
                </p>
              )}
            </div>
          </section>

          {/* Zone 2: the machine. The batch trigger, then the states nobody acts on, folded. */}
          {ready.length > 0 && (
            <section className="mt-8">
              <h2 className="px-2 text-base font-medium text-stone-900">
                Next batch
              </h2>
              <div className="mt-2 px-2">
                <GenerateForm
                  perProduct={env.candidatesPerProduct}
                  ready={ready.length}
                />
              </div>
            </section>
          )}
          <div className="mt-6 border-b border-stone-200">
            {PASSIVE.map((s) =>
              (byStatus.get(s) ?? []).length > 0 ? (
                <Folded key={s} status={s} rows={byStatus.get(s) ?? []} />
              ) : null,
            )}
          </div>

          {/* Zone 3: what comes out. The zip holds every approved image, including ones on
              products still short of done, so the count is approved images, not products. */}
          <section className="mt-8">
            <h2 className="flex items-center gap-2 px-2 text-base font-semibold text-stone-900">
              <StateDot tone="ok" />
              Approved images
              <span className="text-sm font-normal text-stone-600 tabular-nums">
                <span className="sr-only">, </span>
                {spend.approved}
              </span>
            </h2>
            {spend.approved > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2 px-2 sm:grid-cols-2">
                <a href="/export/zip" className={PRIMARY}>
                  <Download {...ICON} />
                  Download {spend.approved}{" "}
                  {spend.approved === 1 ? "image" : "images"}
                </a>
                <a href="/export/csv" className={`${QUIET} min-h-12`}>
                  <Download {...ICON} />
                  Updated CSV
                </a>
              </div>
            ) : (
              <p className="mt-2 px-2 text-sm text-stone-600">
                No approved images yet. The updated CSV is still available:{" "}
                <a
                  href="/export/csv"
                  className="font-medium text-stone-900 underline-offset-4 hover:underline"
                >
                  Updated CSV
                </a>
                .
              </p>
            )}
            {done.length > 0 && (
              <div className="mt-4 border-b border-stone-200">
                <Folded status="done" rows={done} />
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
