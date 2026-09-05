"use client";
import { useActionState, useState } from "react";
import { generateNext } from "@/lib/actions/generate";
import type { EnqueueResult } from "@/lib/enqueue";

/** The batch trigger, one line inside "Ready to generate". No estimate before the tap
 *  (D20); the caps' answer (queued, skipped or refused) comes back under it. */
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
  return (
    <form action={formAction} className="text-sm">
      {/* Two designed lines on a phone (the sentence, then the button), one line on a
          laptop; never a sentence broken by flex. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-stone-700">
          <label htmlFor="n" className="inline-flex min-h-11 items-center">
            Generate the next
          </label>
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
          <span className="whitespace-nowrap">of {ready}</span>
          <span className="whitespace-nowrap text-xs text-stone-600">
            {perProduct} candidates each
          </span>
        </p>
        <button
          disabled={isPending || ready === 0}
          className="min-h-12 w-full rounded-lg bg-stone-900 px-4 py-2 text-base font-medium text-white hover:bg-stone-800 disabled:opacity-50 sm:min-h-11 sm:w-auto sm:text-sm"
        >
          {ready === 0
            ? "Nothing to generate"
            : isPending
              ? "Starting…"
              : "Generate"}
        </button>
      </div>
      {state && (
        <p role="status" className="mt-2">
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
