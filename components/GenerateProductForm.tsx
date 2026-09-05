"use client";
import { useActionState, useId } from "react";
import { generateForProduct } from "@/lib/actions/generate";
import { MAX_IDEA_CHARS } from "@/lib/types";
import type { EnqueueResult } from "@/lib/enqueue";

/** One generate trigger for one product. The caps' answer (queued, skipped or refused) is
 *  shown after the tap; the estimate is not shown before it (D20). */
export function GenerateProductForm({
  sku,
  kind,
  label,
  variant = "primary",
}: {
  sku: string;
  kind: "product" | "retry";
  label: string;
  /** `primary` when generating is the one thing to do on the page (no candidates yet);
   *  `quiet` inside the More menu and the end card, so it never outranks the image. */
  variant?: "primary" | "quiet";
}) {
  const button =
    variant === "quiet"
      ? "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100"
      : "bg-stone-900 text-white hover:bg-stone-800";
  // The retry form can be mounted twice on one page (the More sheet and the end card).
  const noteId = useId();
  const [state, formAction, isPending] = useActionState<
    EnqueueResult | null,
    FormData
  >((_prev, formData) => generateForProduct(formData), null);
  return (
    <form action={formAction} className="space-y-2 text-sm">
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="kind" value={kind} />
      {kind === "retry" && (
        <>
          <label htmlFor={noteId} className="block text-stone-700">
            What should change?
          </label>
          <input
            id={noteId}
            name="note"
            maxLength={MAX_IDEA_CHARS}
            placeholder="Warmer light, less clutter…"
            className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base placeholder:text-stone-600"
          />
        </>
      )}
      <button
        disabled={isPending}
        className={`min-h-11 w-full rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${button}`}
      >
        {isPending ? "Starting…" : label}
      </button>
      {state && (
        <p role="status" className="w-full">
          {state.refused ? (
            <span className="font-medium text-stone-900">{state.refused}</span>
          ) : state.queued === 0 ? (
            `Nothing to generate: ${state.skipped.join(", ") || "already generating or no idea"}`
          ) : (
            // Kept, not dead: a successful enqueue flips the product to "generating" and the
            // page's gate unmounts this form, so today the in-flight cards are the feedback.
            // Delete the gate and this line is what a reviewer sees; the refusal and
            // nothing-to-generate branches above do render, because the status does not change.
            `${state.queued} images queued.`
          )}
        </p>
      )}
    </form>
  );
}
