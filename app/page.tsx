import Link from "next/link";
import { overview } from "@/lib/queries";
import { STATUS_LABEL, PRODUCT_STATUSES } from "@/lib/status";
import { ImportForm } from "@/components/ImportForm";
import { GenerateForm } from "@/components/GenerateForm";
import { SpendPanel } from "@/components/SpendPanel";
import { resumeWorker } from "@/lib/actions/generate";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const { rows, counts, pausedReason } = overview();
  return (
    <main className="mx-auto max-w-3xl p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Styled shots</h1>
      {pausedReason && (
        <div className="rounded bg-amber-100 p-3 text-amber-900 space-y-2">
          <p>Generation paused: {pausedReason}</p>
          <form action={resumeWorker}>
            <button className="rounded bg-amber-700 px-3 py-2 min-h-11 text-white text-sm">
              Resume generation
            </button>
          </form>
        </div>
      )}
      <SpendPanel />
      <GenerateForm
        perProduct={env.candidatesPerProduct}
        costPerImage={env.costPerImage}
        maxInFlight={env.maxInFlight}
        maxTotalSpend={env.maxTotalSpend}
      />
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 text-sm">
        {PRODUCT_STATUSES.map((s) => (
          <div key={s} className="rounded bg-white p-3 shadow-sm">
            <div className="text-2xl">{counts[s] ?? 0}</div>
            {STATUS_LABEL[s]}
          </div>
        ))}
      </section>
      <ImportForm />
      <div className="flex gap-3 text-sm">
        <a
          className="inline-flex min-h-11 items-center underline"
          href="/export/csv"
        >
          Download updated CSV
        </a>
        <a
          className="inline-flex min-h-11 items-center underline"
          href="/export/zip"
        >
          Download approved images
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">
          No products yet. Import the catalog CSV above.
        </p>
      ) : (
        <ul className="divide-y rounded bg-white shadow-sm">
          {rows.map(({ p, status }) => (
            <li key={p.sku}>
              <Link
                href={`/review/${p.sku}`}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {p.sku} · {p.name}
                  </div>
                  <div className="text-xs text-stone-500 truncate">
                    {p.shot_idea ?? "no idea yet"}
                    {p.shot_idea_source === "suggested" && " (suggested)"}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-xs">
                  {STATUS_LABEL[status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
