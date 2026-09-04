"use client";
import { useActionState } from "react";
import { generateNext } from "@/lib/actions/generate";
import type { EnqueueResult } from "@/lib/enqueue";

export function GenerateForm({
  perProduct,
  costPerImage,
  maxInFlight,
  maxTotalSpend,
}: {
  perProduct: number;
  costPerImage: number;
  maxInFlight: number;
  maxTotalSpend: number;
}) {
  const [state, formAction, isPending] = useActionState<
    EnqueueResult | null,
    FormData
  >((_prev, formData) => generateNext(formData), null);
  return (
    <form
      action={formAction}
      className="rounded bg-white p-3 shadow-sm flex flex-wrap items-center gap-2 text-sm"
    >
      <label htmlFor="n">Generate the next</label>
      <input
        id="n"
        type="number"
        name="n"
        defaultValue={10}
        min={1}
        max={40}
        className="w-16 min-h-11 rounded border px-2 py-1"
      />
      <span>
        products · {perProduct} candidates each · about $
        {(10 * perProduct * costPerImage).toFixed(2)} per 10 products
      </span>
      <button
        disabled={isPending}
        className="rounded bg-stone-900 px-3 py-2 min-h-11 text-white disabled:opacity-50"
      >
        {isPending ? "Starting…" : "Generate"}
      </button>
      <span className="text-xs text-stone-500">
        Caps: {maxInFlight} in flight, ${maxTotalSpend} total.
      </span>
      {state && (
        <div className="w-full">
          {state.refused ? (
            <p className="text-amber-700">{state.refused}</p>
          ) : (
            <p>
              {state.queued === 0
                ? "Nothing to generate."
                : `${state.queued} images queued, about $${state.estimatedUsd.toFixed(2)}.`}
            </p>
          )}
          {state.skipped.length > 0 && (
            <p className="text-xs text-stone-500">
              Skipped (already generating or no idea):{" "}
              {state.skipped.join(", ")}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
