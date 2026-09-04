"use client";
import { useActionState, useState } from "react";
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
  const [n, setN] = useState(10);
  // Clamp only for the shown estimate; the input's own min/max already stop the user
  // reaching an out-of-range value, this just covers a cleared or partial field.
  const clampedN = Math.min(40, Math.max(1, n));
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
        value={n}
        min={1}
        max={40}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          setN(Number.isFinite(v) ? v : 10);
        }}
        className="w-16 min-h-11 rounded border px-2 py-1"
      />
      <span>
        products · {perProduct} candidates each · about $
        {(clampedN * perProduct * costPerImage).toFixed(2)} for {clampedN}{" "}
        products
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
