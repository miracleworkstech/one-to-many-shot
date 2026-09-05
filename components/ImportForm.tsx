"use client";
import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { importCatalog } from "@/lib/actions/import";
import { PRIMARY, QUIET } from "./buttons";

type ImportResult = { imported: number; suggested: number; errors: string[] };

/** The entry point for a new export. The file chooser submits on pick, so the flow is
 *  two taps; the one helper line answers the fear that stops a re-import. `primary` is
 *  the empty catalog, where importing is the only thing to do and the control sits
 *  inline; `quiet` is the header control, which opens a sheet holding the same form. */
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
  const body = (
    <>
      <form ref={form} action={formAction}>
        <label
          className={`${PRIMARY} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-900 ${isPending ? "opacity-50" : ""}`}
        >
          <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
          {isPending ? "Importing…" : "Import CSV"}
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            disabled={isPending}
            onChange={(e) => {
              const input = e.currentTarget;
              form.current?.requestSubmit();
              // The submit has read the file; clear the input so picking the same CSV
              // again (a fixed export) fires change again.
              setTimeout(() => (input.value = ""), 0);
            }}
            className="sr-only"
          />
        </label>
        <p className="mt-1 text-xs text-stone-600">
          Existing approvals are kept.
        </p>
      </form>
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
    </>
  );
  if (variant === "primary") return body;
  return (
    <>
      <button type="button" popoverTarget="import" className={QUIET}>
        <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
        Import CSV
      </button>
      {/* The sheet stays open through the server action, so the result lands in it. */}
      <div id="import" popover="auto" className="sheet space-y-3 text-sm">
        <p className="text-stone-800">Import a new export from the sheet.</p>
        {body}
      </div>
    </>
  );
}
