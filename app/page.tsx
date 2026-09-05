import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { overview } from "@/lib/queries";
import { spendSummary } from "@/lib/analytics";
import { pageOf, pageParam } from "@/lib/paging";
import {
  DONE_AT,
  STATUS_LABEL,
  STATUS_TONE,
  type ProductStatus,
} from "@/lib/status";
import type { Product } from "@/lib/types";
import { ImportForm } from "@/components/ImportForm";
import { GenerateForm } from "@/components/GenerateForm";
import { StateDot, type Tone } from "@/components/StateDot";
import { resumeWorker } from "@/lib/actions/generate";
import { env } from "@/lib/env";
import { PRIMARY, QUIET } from "@/components/buttons";

export const dynamic = "force-dynamic";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Reading order is who has to act: the reviewer's queue, then the batch trigger, then
 *  what needs nobody. Not the enum's order, which is the lifecycle. The queue and Ready
 *  open on every load; the rest fold to a count. */
const PASSIVE: readonly ProductStatus[] = [
  "generating",
  "failed",
  "no_idea",
  "done",
];
/** Rows per page. A 40-product drop is four pages of Ready at most; 300 done is 25. */
const PAGE = 12;

const usd = (n: number) => `$${n.toFixed(2)}`;

type Row = {
  p: Product;
  status: ProductStatus;
  toDecide: number;
  approved: number;
};
/** Flat query string, first value of a repeated key, for the pagers' links. */
type Params = Record<string, string>;

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

const PAGER =
  "inline-flex min-h-11 min-w-22 items-center justify-center gap-1 rounded-lg px-2 font-medium";

/** "1–12 of 33" with Previous and Next as plain links: a query parameter per group and
 *  the group's anchor, so the reload lands back on the list it came from. */
function Pager({
  id,
  label,
  page,
  pages,
  from,
  to,
  total,
  params,
}: {
  id: string;
  label: string;
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  params: Params;
}) {
  if (pages <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(params);
    q.set(id, String(n));
    return `?${q}#${id}`;
  };
  const off = `${PAGER} text-stone-400`;
  const on = `${PAGER} text-stone-800 hover:bg-stone-100`;
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex items-center justify-between px-2 pt-1 text-sm"
    >
      <span className="text-stone-600 tabular-nums">
        {from}–{to} of {total}
      </span>
      <span className="flex gap-1">
        {page > 1 ? (
          <a href={href(page - 1)} className={on}>
            <ChevronLeft {...ICON} />
            Previous
          </a>
        ) : (
          <span className={off} aria-disabled="true">
            <ChevronLeft {...ICON} />
            Previous
          </span>
        )}
        {page < pages ? (
          <a href={href(page + 1)} className={on}>
            Next
            <ChevronRight {...ICON} />
          </a>
        ) : (
          <span className={off} aria-disabled="true">
            Next
            <ChevronRight {...ICON} />
          </span>
        )}
      </span>
    </nav>
  );
}

/** One group: a disclosure whose summary is the heading, a dot and the count, then a
 *  page of rows. `open` groups open on every load; a page link also opens its group. */
function Group({
  id,
  label,
  tone,
  rows,
  open,
  params,
  empty,
  children,
}: {
  id: string;
  label: string;
  tone: Tone;
  rows: Row[];
  open: boolean;
  params: Params;
  empty?: string;
  children?: React.ReactNode;
}) {
  const pg = pageOf(rows, pageParam(params[id]), PAGE);
  return (
    <details
      id={id}
      open={open || params[id] !== undefined}
      className="border-t border-stone-300"
    >
      <summary className="flex min-h-14 cursor-pointer select-none items-center rounded-lg px-2 hover:bg-stone-100">
        <h2 className="flex flex-1 items-center gap-2.5 text-xl font-semibold text-stone-900">
          <ChevronDown {...ICON} className="chevron text-stone-500" />
          <StateDot tone={tone} />
          <span className="flex-1">{label}</span>
          <span className="font-normal text-stone-500 tabular-nums">
            <span className="sr-only">, </span>
            {rows.length}
          </span>
        </h2>
      </summary>
      <div className="pb-3">
        {children}
        {rows.length > 0 ? (
          <ul className="divide-y divide-stone-200">
            {pg.items.map((r) => (
              <Item key={r.p.sku} {...r} />
            ))}
          </ul>
        ) : (
          <p className="px-2 py-2 text-sm text-stone-600">{empty}</p>
        )}
        <Pager
          id={id}
          label={label}
          page={pg.page}
          pages={pg.pages}
          from={pg.from}
          to={pg.to}
          total={rows.length}
          params={params}
        />
      </div>
    </details>
  );
}

/** A thin bar of the drop: done in moss, needing a decision in ochre, the rest stone.
 *  Colour only where the page already gives it meaning. */
function Bar({
  parts,
  label,
}: {
  parts: { n: number; className: string }[];
  label: string;
}) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-2 overflow-hidden rounded-full bg-stone-200"
    >
      {parts.map((p, i) =>
        p.n > 0 ? (
          <div
            key={i}
            className={p.className}
            style={{ width: `${(100 * p.n) / Math.max(total, 1)}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: Params = {};
  for (const [k, v] of Object.entries(raw)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (first !== undefined) params[k] = first;
  }

  const { rows, pausedReason } = overview();
  const spend = spendSummary();
  const total = rows.length;
  const queue = rows.filter(needsDecision);
  // Every row lands in exactly one list: the queue wins over the lifecycle groups.
  const byStatus = new Map<ProductStatus, Row[]>();
  for (const r of rows)
    if (!needsDecision(r))
      byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);
  const ready = byStatus.get("idea_ready") ?? [];
  const done = byStatus.get("done") ?? [];
  const toGo = total - done.length - queue.length;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-3 pb-10">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">Styled shots</h1>
        {total > 0 && (
          <div className="ml-auto flex items-center gap-2 [anchor-name:--sheet]">
            <button type="button" popoverTarget="csv" className={QUIET}>
              CSV
              <ChevronDown {...ICON} className="text-stone-500" />
            </button>
            {/* The sheet's two directions: the updated export out, a new export in. */}
            <div id="csv" popover="auto" className="sheet space-y-2 text-sm">
              <a href="/export/csv" className={`${QUIET} w-full`}>
                <Download {...ICON} />
                Updated CSV
              </a>
              <ImportForm />
            </div>

            <button
              type="button"
              popoverTarget="spend"
              className={`${QUIET} tabular-nums`}
            >
              {usd(spend.spent)} spent
              <ChevronDown {...ICON} className="text-stone-500" />
            </button>
            {/* Spend is a bound, not a receipt: the total against the cap, then one line
                on where it went (D20, amended; D23). */}
            <div id="spend" popover="auto" className="sheet text-sm">
              <p className="tabular-nums">
                <span className="text-xl font-semibold text-stone-900">
                  {usd(spend.spent)}
                </span>{" "}
                <span className="text-stone-600">
                  of {usd(env.maxTotalSpend)} budget
                </span>
              </p>
              <div className="mt-2">
                <Bar
                  parts={[
                    { n: spend.spent, className: "bg-stone-900" },
                    {
                      n: Math.max(env.maxTotalSpend - spend.spent, 0),
                      className: "",
                    },
                  ]}
                  label={`${usd(spend.spent)} spent of the ${usd(env.maxTotalSpend)} budget`}
                />
              </div>
              <p className="mt-2 text-xs text-stone-600 tabular-nums">
                {usd(spend.spentApproved)} on approved images ·{" "}
                {usd(spend.spentWasted)} on rejected or failed
                {spend.spentPending > 0 &&
                  ` · ${usd(spend.spentPending)} undecided`}
              </p>
            </div>
          </div>
        )}
      </header>

      {total > 0 && (
        <div className="mt-4">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-medium text-stone-900 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <StateDot tone="ok" />
              {done.length} of {total} done
            </span>
            {queue.length > 0 ? (
              <a
                href="#decide"
                className="-my-3 inline-flex items-center gap-1.5 rounded-lg py-3 hover:bg-stone-100"
              >
                <StateDot tone="wait" />
                {queue.length} {queue.length === 1 ? "needs" : "need"} a
                decision
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <StateDot tone="wait" />
                Nothing to decide
              </span>
            )}
            {toGo > 0 && <span className="text-stone-600">{toGo} to go</span>}
          </p>
          <div className="mt-2">
            <Bar
              parts={[
                { n: done.length, className: "bg-moss" },
                { n: queue.length, className: "bg-ochre" },
                { n: toGo, className: "" },
              ]}
              label={`${done.length} done, ${queue.length} need a decision, ${toGo} to go, of ${total}`}
            />
          </div>
        </div>
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
        <div className="mt-6 border-b border-stone-300">
          <Group
            id="decide"
            label="Needs a decision"
            tone="wait"
            rows={queue}
            open
            params={params}
            empty="Nothing needs a decision right now."
          />
          {ready.length > 0 && (
            <Group
              id="ready"
              label={STATUS_LABEL.idea_ready}
              tone={STATUS_TONE.idea_ready}
              rows={ready}
              open
              params={params}
            >
              {/* The batch trigger is its own interaction: a button, then a sheet with
                  the count and the answer. Money stays behind one deliberate tap. */}
              <div className="px-2 pt-1 pb-3">
                <button
                  type="button"
                  popoverTarget="batch"
                  className={`${PRIMARY} sm:w-auto`}
                >
                  Generate a batch
                </button>
              </div>
            </Group>
          )}
          {/* The sheet lives outside the Ready group so its answer survives a batch that
              takes every ready product: the group unmounts, the sheet and its result stay. */}
          <div id="batch" popover="auto" className="lightbox">
            <GenerateForm
              perProduct={env.candidatesPerProduct}
              ready={ready.length}
            />
          </div>
          {PASSIVE.map((s) =>
            (byStatus.get(s) ?? []).length > 0 ? (
              <Group
                key={s}
                id={s}
                label={STATUS_LABEL[s]}
                tone={STATUS_TONE[s]}
                rows={byStatus.get(s) ?? []}
                open={false}
                params={params}
              />
            ) : null,
          )}
        </div>
      )}

      {/* The way out, on its own at the end: the zip holds every approved image,
          including ones on products still short of done, so the count is images. */}
      {total > 0 && (
        <section className="mt-8">
          {spend.approved > 0 ? (
            <a href="/export/zip" className={PRIMARY}>
              <Download {...ICON} />
              Download {spend.approved} approved{" "}
              {spend.approved === 1 ? "image" : "images"}
            </a>
          ) : (
            <p className="text-center text-sm text-stone-600">
              No approved images to download yet.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
