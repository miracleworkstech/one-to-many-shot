"use client";
import { useActionState, useState } from "react";
import { generateNext } from "@/lib/actions/generate";
import type { EnqueueResult } from "@/lib/enqueue";
import { PRIMARY } from "./buttons";
import { Spinner } from "./Pending";

/** The batch trigger, inside the "Generate a batch" sheet. No estimate before the tap
 *  (D20); the caps' answer (queued, skipped or refused) comes back under the button, and
 *  the sheet stays open so the answer is read where the tap happened. */
export function GenerateForm({
  perProduct,
  ready,
}: {
  perProduct: number;
  /** Products with an idea and no candidates yet: the most this form can usefully ask for. */
  ready: number;
}) {
  const max = Math.max(1, Math.min(40, ready));
  const [state, formAction, isPending] = useActionState<
    EnqueueResult | null,
    FormData
  >((_prev, formData) => generateNext(formData), null);
  const [n, setN] = useState(Math.min(10, max));
  // `ready` shrinks after every batch (revalidation re-renders with a smaller max) while
  // `n` is preserved state; re-clamp during render so the input and the submitted count agree.
  const [prevMax, setPrevMax] = useState(max);
  if (max !== prevMax) {
    setPrevMax(max);
    if (n > max) setN(max);
  }
  const images = Math.min(Math.max(n, 1), max) * perProduct;
  return (
    <form action={formAction} className="space-y-3 text-sm">
      <h2 className="text-base font-semibold text-stone-900">
        Generate a batch
      </h2>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-stone-700">
        <label htmlFor="n" className="inline-flex min-h-11 items-center">
          The next
        </label>
        <input
          id="n"
          type="number"
          name="n"
          aria-label="Products in this batch"
          value={n}
          min={1}
          max={max}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            setN(Number.isFinite(v) ? v : Math.min(10, max));
          }}
          className="w-16 min-h-11 rounded-lg border border-stone-300 bg-white px-2 py-1 text-base tabular-nums"
        />
        <span className="whitespace-nowrap">of {ready} ready</span>
      </p>
      <p className="text-xs text-stone-600 tabular-nums">
        {perProduct} candidates each, {images}{" "}
        {images === 1 ? "image" : "images"}.
      </p>
      <button
        disabled={isPending || ready === 0}
        aria-busy={isPending}
        className={`${PRIMARY} disabled:opacity-60`}
      >
        {ready === 0 ? (
          "Nothing to generate"
        ) : isPending ? (
          <>
            <Spinner />
            Starting…
          </>
        ) : (
          "Generate"
        )}
      </button>
      {state && (
        <p role="status" className="arrive">
          {state.refused ? (
            <span className="font-medium text-stone-900">{state.refused}</span>
          ) : state.queued === 0 ? (
            "Nothing to generate."
          ) : (
            `${state.queued} images queued.`
          )}
          {state.skipped.length > 0 && (
            <span className="block text-xs text-stone-600">
              Skipped (already generating or no idea):{" "}
              {state.skipped.join(", ")}
            </span>
          )}
        </p>
      )}
    </form>
  );
}
