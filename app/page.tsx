import Link from "next/link";
import { ChevronDown, Download } from "lucide-react";
import { overview } from "@/lib/queries";
import { recentBatches, spendSummary } from "@/lib/analytics";
import { STATUS_LABEL, STATUS_TONE, type ProductStatus } from "@/lib/status";
import type { Product } from "@/lib/types";
import { ImportForm } from "@/components/ImportForm";
import { GenerateForm } from "@/components/GenerateForm";
import { StateDot } from "@/components/StateDot";
import { resumeWorker } from "@/lib/actions/generate";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Reading order is who has to act: the reviewer's queue, then the batch trigger, then
 *  what needs nobody. Not the enum's order, which is the lifecycle. */
const TIER_ONE: readonly ProductStatus[] = ["in_review", "needs_more"];
const TIER_THREE: readonly ProductStatus[] = [
  "failed",
  "no_idea",
  "generating",
  "done",
];
/** Groups that open by default. Done is the long one and needs nothing from anyone. */
const CLOSED: ReadonlySet<ProductStatus> = new Set(["done"]);
/** Rows shown before a group folds the rest. A 40-product drop fits; 300 done do not. */
const PAGE = 12;

const usd = (n: number) => `$${n.toFixed(2)}`;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const shortDate = (sqlite: string) =>
  `${Number(sqlite.slice(8, 10))} ${MONTHS[Number(sqlite.slice(5, 7)) - 1]}`;

type Row = { p: Product; status: ProductStatus; toDecide: number };

function Rows({ rows, page = PAGE }: { rows: Row[]; page?: number }) {
  const head = rows.slice(0, page);
  const rest = rows.slice(page);
  const Item = ({ p, toDecide }: Row) => (
    <li>
      <Link
        href={`/review/${p.sku}`}
        className="flex min-h-12 items-center gap-3 rounded-lg px-1 py-2 hover:bg-stone-100"
      >
        <span className="w-16 shrink-0 truncate text-xs text-stone-600 tabular-nums">
          {p.sku}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block truncate text-xs text-stone-600">
            {p.shot_idea ?? "No idea yet"}
          </span>
        </span>
        {toDecide > 0 && (
          <span className="shrink-0 text-xs text-stone-600 tabular-nums">
            {toDecide} to decide
          </span>
        )}
      </Link>
    </li>
  );
  return (
    <>
      <ul className="divide-y divide-stone-200">
        {head.map((r) => (
          <Item key={r.p.sku} {...r} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center gap-1 rounded-lg px-1 text-sm font-medium text-stone-700 hover:bg-stone-100">
            <ChevronDown {...ICON} className="chevron" />
            {head.length === 0
              ? `Show the ${rest.length} products`
              : `Show ${rest.length} more`}
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

function Group({
  status,
  rows,
  tier,
  children,
}: {
  status: ProductStatus;
  rows: Row[];
  tier: 1 | 2 | 3;
  children?: React.ReactNode;
}) {
  return (
    <details
      open={!CLOSED.has(status)}
      className="border-t border-stone-300 py-1"
    >
      <summary className="flex min-h-12 cursor-pointer select-none items-center gap-2 px-1">
        <ChevronDown {...ICON} className="chevron text-stone-500" />
        <h2
          className={`inline-flex flex-1 items-center gap-2 text-base ${
            tier === 1
              ? "font-semibold text-stone-900"
              : "font-medium text-stone-800"
          }`}
        >
          <StateDot tone={STATUS_TONE[status]} />
          {STATUS_LABEL[status]}
        </h2>
        <span className="text-sm text-stone-600 tabular-nums">
          {rows.length}
        </span>
      </summary>
      <div className="pb-3 pl-1">
        {children}
        {rows.length > 0 ? (
          // The batch trigger is the point of tier 2; its rows fold, nobody reads 35 to tap one button.
          <Rows rows={rows} page={tier === 2 ? 0 : PAGE} />
        ) : (
          <p className="px-1 py-2 text-sm text-stone-600">
            {status === "in_review"
              ? "Nothing waiting for review."
              : "Nothing here."}
          </p>
        )}
      </div>
    </details>
  );
}

export default function Home() {
  const { rows, counts, pausedReason } = overview();
  const spend = spendSummary();
  const batches = recentBatches(5);
  const total = rows.length;
  const done = counts.done ?? 0;
  const waiting = counts.in_review ?? 0;
  const byStatus = new Map<ProductStatus, Row[]>();
  for (const r of rows)
    byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);
  const ready = byStatus.get("idea_ready") ?? [];

  return (
    <main className="mx-auto max-w-2xl px-4 pt-3 pb-10">
      <header>
        <h1 className="text-xl font-semibold">Styled shots</h1>
        {total > 0 && (
          <p className="mt-1 text-base text-stone-800 tabular-nums">
            {done} of {total} done
            {waiting > 0 && ` · ${waiting} waiting for review`}
          </p>
        )}
      </header>

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
          {/* One row, so the reviewer's queue stays on the first screen: the approved images
              are the main way out, a new export is the way in. */}
          <div className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-2">
            {spend.approved > 0 ? (
              <a
                href="/export/zip"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-stone-900 px-4 font-medium text-white hover:bg-stone-800"
              >
                <Download {...ICON} />
                Download {spend.approved} approved{" "}
                {spend.approved === 1 ? "image" : "images"}
              </a>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-stone-300 px-4 text-stone-500">
                <Download {...ICON} />
                No approved images yet
              </span>
            )}
            <ImportForm />
            <a
              href="/export/csv"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
            >
              Updated CSV
            </a>
          </div>

          <div className="mt-6">
            {TIER_ONE.map((s) => (
              <Group key={s} status={s} rows={byStatus.get(s) ?? []} tier={1} />
            ))}
            <Group status="idea_ready" rows={ready} tier={2}>
              <div className="px-1 pt-1 pb-3">
                <GenerateForm
                  perProduct={env.candidatesPerProduct}
                  ready={ready.length}
                />
              </div>
            </Group>
            {TIER_THREE.map((s) =>
              (byStatus.get(s) ?? []).length > 0 ? (
                <Group
                  key={s}
                  status={s}
                  rows={byStatus.get(s) ?? []}
                  tier={3}
                />
              ) : null,
            )}
          </div>

          {/* Spend is a bound, not a receipt: total first, the rest as prose, all behind
              one disclosure (D20). */}
          <details className="mt-6 border-t border-stone-300 py-1">
            <summary className="flex min-h-12 cursor-pointer select-none items-center gap-2 px-1 text-base font-medium text-stone-800">
              <ChevronDown {...ICON} className="chevron text-stone-500" />
              Spend
            </summary>
            <div className="space-y-2 px-1 pb-3 text-sm text-stone-800">
              <p className="text-base font-semibold text-stone-900 tabular-nums">
                {usd(spend.spent)} spent of {usd(env.maxTotalSpend)}
              </p>
              <p className="tabular-nums">
                {usd(spend.spentApproved)} on approved images,{" "}
                {usd(spend.spentWasted)} on rejected or failed
                {spend.spentPending > 0 &&
                  `, ${usd(spend.spentPending)} still being decided`}
                .
                {spend.costPerApproved != null &&
                  ` About ${usd(spend.costPerApproved)} per approved image`}
                {spend.approvalRate != null &&
                  `, ${Math.round(spend.approvalRate * 100)}% of decisions approve`}
                {spend.costPerApproved != null && "."}
              </p>
              {batches.length > 0 && (
                <ul className="divide-y divide-stone-200 text-stone-700">
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
          </details>
        </>
      )}
    </main>
  );
}
