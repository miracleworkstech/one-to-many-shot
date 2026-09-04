"use client";
import { useActionState } from "react";
import { generateForProduct } from "@/lib/actions/generate";
import { MAX_IDEA_CHARS } from "@/lib/types";
import type { EnqueueResult } from "@/lib/enqueue";

/** One generate trigger for one product. Money path #11: the cost is on the button before
 *  the tap, and the caps' answer (queued, skipped or refused) is shown after it. */
export function GenerateProductForm({
  sku,
  kind,
  label,
  costUsd,
}: {
  sku: string;
  kind: "product" | "retry";
  label: string;
  costUsd: number;
}) {
  const [state, formAction, isPending] = useActionState<
    EnqueueResult | null,
    FormData
  >((_prev, formData) => generateForProduct(formData), null);
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="kind" value={kind} />
      {kind === "retry" && (
        <input
          name="note"
          aria-label="What to change"
          maxLength={MAX_IDEA_CHARS}
          placeholder="What to change (optional)"
          className="min-h-11 w-full min-w-0 flex-1 rounded border px-2 text-sm sm:w-auto"
        />
      )}
      <button
        disabled={isPending}
        className="min-h-11 rounded bg-stone-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "Starting…" : `${label} · $${costUsd.toFixed(2)}`}
      </button>
      {state && (
        <p role="status" className="w-full">
          {state.refused ? (
            <span className="text-amber-700">{state.refused}</span>
          ) : state.queued === 0 ? (
            `Nothing to generate: ${state.skipped.join(", ") || "already generating or no idea"}`
          ) : (
            // Kept, not dead: a successful enqueue flips the product to "generating" and the
            // page's gate unmounts this form, so today the candidate cards are the feedback.
            // Delete the gate and this line is what a reviewer sees; the refusal and
            // nothing-to-generate branches above do render, because the status does not change.
            `${state.queued} images queued, about $${state.estimatedUsd.toFixed(2)}.`
          )}
        </p>
      )}
    </form>
  );
}
