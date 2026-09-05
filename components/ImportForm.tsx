"use client";
import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { importCatalog } from "@/lib/actions/import";
import { PRIMARY, QUIET } from "./buttons";
import { Spinner } from "./Pending";

type ImportResult = { imported: number; suggested: number; errors: string[] };

/** The entry point for a new export. The file chooser submits on pick, so the flow is
 *  two taps; the one helper line answers the fear that stops a re-import. `primary` is
 *  the empty catalog, where importing is the only thing to do; `quiet` sits in the Files
 *  sheet under the two downloads. */
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
  return (
    <div>
      <form ref={form} action={formAction}>
        <label
          className={`${variant === "primary" ? PRIMARY : `${QUIET} w-full`} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-stone-900 ${isPending ? "opacity-50" : ""}`}
        >
          {isPending ? (
            <Spinner />
          ) : (
            <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
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
        <div role="status" className="arrive mt-2 text-sm">
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
    </div>
  );
}
