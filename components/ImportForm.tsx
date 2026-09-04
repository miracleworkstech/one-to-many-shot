"use client";
import { useActionState } from "react";
import { importCatalog } from "@/lib/actions/import";

type ImportResult = { imported: number; suggested: number; errors: string[] };

export function ImportForm() {
  const [state, formAction, isPending] = useActionState<
    ImportResult | null,
    FormData
  >((_prev, formData) => importCatalog(formData), null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="min-h-11 text-sm"
      />
      <button
        disabled={isPending}
        className="min-h-11 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
      >
        {isPending ? "Importing…" : "Import catalog CSV"}
      </button>
      <span className="text-xs text-stone-600">
        Same columns as the export. Existing approvals are kept.
      </span>
      {state && (
        <div className="w-full text-sm">
          <p>
            {state.imported} imported, {state.suggested} suggested
          </p>
          {state.errors.length > 0 && (
            <ul className="list-disc pl-5 text-amber-700">
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
