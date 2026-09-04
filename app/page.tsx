import Link from "next/link";
import { overview } from "@/lib/queries";
import { spendSummary } from "@/lib/analytics";
import { STATUS_LABEL, type ProductStatus } from "@/lib/status";
import type { Product } from "@/lib/types";
import { ImportForm } from "@/components/ImportForm";
import { GenerateForm } from "@/components/GenerateForm";
import { SpendPanel } from "@/components/SpendPanel";
import { resumeWorker } from "@/lib/actions/generate";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Reading order is action order: what someone has to do next comes first, what is
 *  finished comes last. Not the enum's order, which is the lifecycle. */
const GROUPS: readonly ProductStatus[] = [
  "in_review",
  "needs_more",
  "failed",
  "generating",
  "idea_ready",
  "no_idea",
  "done",
];
/** Groups that open by default. Done is the long one and needs nothing from anyone. */
const OPEN: ReadonlySet<ProductStatus> = new Set([
  "in_review",
  "needs_more",
  "failed",
  "generating",
  "idea_ready",
  "no_idea",
]);
/** Rows shown before a group folds the rest behind "Show N more". A 40-product drop fits
 *  in three screens; 300 done products do not. */
const PAGE = 12;

const usd = (n: number) => `$${n.toFixed(2)}`;

function Row({ p }: { p: Product }) {
  return (
    <li>
      <Link
        href={`/review/${p.sku}`}
        className="flex min-h-12 items-center gap-3 px-1 py-2 hover:bg-stone-100"
      >
        <span className="w-16 shrink-0 truncate text-xs text-stone-600 tabular-nums">
          {p.sku}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block truncate text-xs text-stone-600">
            {p.shot_idea ?? "no idea yet"}
            {p.shot_idea_source === "suggested" && " (suggested)"}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Rows({ ps }: { ps: Product[] }) {
  const head = ps.slice(0, PAGE);
  const rest = ps.slice(PAGE);
  return (
    <>
      <ul className="divide-y divide-stone-200">
        {head.map((p) => (
          <Row key={p.sku} p={p} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center px-1 text-sm text-stone-700 underline">
            Show {rest.length} more
          </summary>
          <ul className="divide-y divide-stone-200">
            {rest.map((p) => (
              <Row key={p.sku} p={p} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function Home() {
  const { rows, counts, pausedReason } = overview();
  const spend = spendSummary();
  const total = rows.length;
  const done = counts.done ?? 0;
  const waiting = counts.in_review ?? 0;
  const byStatus = new Map<ProductStatus, Product[]>();
  for (const { p, status } of rows)
    byStatus.set(status, [...(byStatus.get(status) ?? []), p]);

  return (
    <main className="mx-auto max-w-2xl px-4 pt-3 pb-10">
      <header>
        <h1 className="text-xl font-semibold">Styled shots</h1>
        {total > 0 && (
          <p className="mt-1 text-base text-stone-800 tabular-nums">
            {done} of {total} done
            {waiting > 0 && ` · ${waiting} waiting for review`}
            {` · ${usd(spend.spent)} of ${usd(env.maxTotalSpend)} spent`}
          </p>
        )}
      </header>

      {pausedReason && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>Generation paused: {pausedReason}</p>
          <form action={resumeWorker} className="mt-2">
            <button className="min-h-11 rounded-lg bg-amber-800 px-3 py-2 text-sm text-white hover:bg-amber-900">
              Resume generation
            </button>
          </form>
        </div>
      )}

      {total === 0 ? (
        <section className="mt-6">
          <p className="text-sm text-stone-700">
            No products yet. Import Maya&apos;s export to start.
          </p>
          <div className="mt-3">
            <ImportForm />
          </div>
        </section>
      ) : (
        <div className="mt-6">
          {GROUPS.map((s) => {
            const ps = byStatus.get(s) ?? [];
            if (ps.length === 0 && s !== "idea_ready") return null;
            return (
              <details
                key={s}
                open={OPEN.has(s)}
                className="border-t border-stone-300 py-1"
              >
                <summary className="flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 px-1 text-base font-medium">
                  <span>{STATUS_LABEL[s]}</span>
                  <span className="text-sm text-stone-600 tabular-nums">
                    {ps.length}
                  </span>
                </summary>
                <div className="pb-3">
                  {s === "idea_ready" && (
                    <div className="px-1 pb-4 pt-1">
                      <GenerateForm
                        perProduct={env.candidatesPerProduct}
                        costPerImage={env.costPerImage}
                        maxInFlight={env.maxInFlight}
                        maxTotalSpend={env.maxTotalSpend}
                        ready={ps.length}
                      />
                    </div>
                  )}
                  {ps.length > 0 ? (
                    <Rows ps={ps} />
                  ) : (
                    <p className="px-1 py-3 text-sm text-stone-600">
                      Nothing waiting. Every product with an idea has
                      candidates.
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {total > 0 && (
        <>
          <details className="mt-6 border-t border-stone-300 py-1">
            <summary className="inline-flex min-h-12 cursor-pointer select-none items-center px-1 text-base font-medium">
              Spend and recent batches
            </summary>
            <div className="px-1 pb-3">
              <SpendPanel />
            </div>
          </details>

          <section className="mt-6 border-t border-stone-300 px-1 pt-3">
            <h2 className="text-base font-medium">The sheet</h2>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <a
                className="inline-flex min-h-11 items-center underline"
                href="/export/csv"
              >
                Download the updated CSV
              </a>
              <a
                className="inline-flex min-h-11 items-center underline"
                href="/export/zip"
              >
                Download approved images
              </a>
            </div>
            <div className="mt-2">
              <ImportForm />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
