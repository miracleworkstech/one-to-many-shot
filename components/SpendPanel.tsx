import { spendSummary, recentBatches } from "@/lib/analytics";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function SpendPanel() {
  const s = spendSummary();
  const batches = recentBatches(5);
  return (
    <section className="rounded bg-white p-3 shadow-sm text-sm space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <div className="text-xl">{usd(s.spent)}</div>spent total
        </div>
        <div>
          <div className="text-xl">{usd(s.spentApproved)}</div>on approved
        </div>
        <div>
          <div className="text-xl">{usd(s.spentWasted)}</div>on rejected or
          failed
        </div>
        <div>
          <div className="text-xl">
            {s.costPerApproved == null ? "–" : usd(s.costPerApproved)}
          </div>
          per approved image
          {s.approvalRate != null &&
            ` · ${Math.round(s.approvalRate * 100)}% approved`}
        </div>
      </div>
      {batches.length > 0 && (
        <table className="w-full text-xs text-stone-600">
          <caption className="text-left">Recent batches</caption>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{b.created_at}</td>
                <td>{b.kind}</td>
                <td>{b.images} images</td>
                <td>est {usd(b.estimated_usd)}</td>
                <td>actual {usd(b.actual_usd)}</td>
                <td>{b.approved} approved</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
