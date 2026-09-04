"use client";
import { useActionState, useState } from "react";
import { generateNext } from "@/lib/actions/generate";
import type { EnqueueResult } from "@/lib/enqueue";

export function GenerateForm({
  perProduct,
  costPerImage,
  maxInFlight,
  maxTotalSpend,
  ready,
}: {
  perProduct: number;
  costPerImage: number;
  maxInFlight: number;
  maxTotalSpend: number;
  /** Products with an idea and no candidates yet: the most this form can usefully ask for. */
  ready: number;
}) {
  const max = Math.max(1, Math.min(40, ready));
  const [state, formAction, isPending] = useActionState<
    EnqueueResult | null,
    FormData
  >((_prev, formData) => generateNext(formData), null);
  const [n, setN] = useState(Math.min(10, max));
  // Clamp only for the shown estimate; the input's own min/max already stop the user
  // reaching an out-of-range value, this just covers a cleared or partial field.
  const clampedN = Math.min(max, Math.max(1, n));
  const estimate = (clampedN * perProduct * costPerImage).toFixed(2);
  return (
    <form action={formAction} className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="n">Generate the next</label>
        <input
          id="n"
          type="number"
          name="n"
          value={n}
          min={1}
          max={max}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            setN(Number.isFinite(v) ? v : Math.min(10, max));
          }}
          className="w-16 min-h-11 rounded-lg border border-stone-300 bg-white px-2 py-1 text-base tabular-nums"
        />
        <span>
          of {ready} ready · {perProduct} candidates each
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={isPending || ready === 0}
          className="min-h-11 rounded-lg bg-stone-900 px-3 py-2 text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {isPending ? "Starting…" : `Generate · about $${estimate}`}
        </button>
        <span className="text-xs text-stone-600">
          Caps: {maxInFlight} images in flight, ${maxTotalSpend} total.
        </span>
      </div>
      {state && (
        <div className="w-full">
          {state.refused ? (
            <p className="text-amber-800">{state.refused}</p>
          ) : (
            <p>
              {state.queued === 0
                ? "Nothing to generate."
                : `${state.queued} images queued, about $${state.estimatedUsd.toFixed(2)}.`}
            </p>
          )}
          {state.skipped.length > 0 && (
            <p className="text-xs text-stone-600">
              Skipped (already generating or no idea):{" "}
              {state.skipped.join(", ")}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
