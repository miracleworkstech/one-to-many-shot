"use client";
import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { importCatalog } from "@/lib/actions/import";

type ImportResult = { imported: number; suggested: number; errors: string[] };

/** The entry point for a new export. One button that opens the file chooser and submits
 *  on pick, so the flow is two taps; the one helper line answers the fear that stops a
 *  re-import. `primary` is for the empty catalog, where importing is the only thing to do. */
export function ImportForm({
  variant = "quiet",
}: {
  variant?: "primary" | "quiet";
}) {
  const [state, formAction, isPending] = useActionState<
    ImportResult | null,
    FormData
  >((_prev, formData) => importCatalog(formData), null);
  const form = useRef<HTMLFormElement>(null);
  const button =
    variant === "primary"
      ? "bg-stone-900 text-white hover:bg-stone-800"
      : "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100";
  return (
    <form ref={form} action={formAction}>
      <label
        className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-4 font-medium ${button} ${isPending ? "opacity-50" : ""}`}
      >
        <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
        {isPending ? "Importing…" : "Import CSV"}
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          disabled={isPending}
          onChange={() => form.current?.requestSubmit()}
          className="sr-only"
        />
      </label>
      <p className="mt-1 text-xs text-stone-600">
        Existing approvals are kept.
      </p>
      {state && (
        <div role="status" className="mt-2 text-sm">
          <p>
            {state.imported} imported
            {state.suggested > 0 && `, ${state.suggested} ideas suggested`}
          </p>
          {state.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-stone-900">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
