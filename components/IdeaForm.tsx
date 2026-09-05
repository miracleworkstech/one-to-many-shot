"use client";
import { useActionState, useState } from "react";
import { MAX_IDEA_CHARS } from "@/lib/types";

/** The shot idea, shown as text and edited in place: the textarea *is* the caption, with no
 *  border until it has focus, so the criterion the reviewer judges against is never shown
 *  twice. Save appears only while the text differs from what is stored. */
export function IdeaForm({
  sku,
  idea,
  source,
  onSave,
}: {
  sku: string;
  idea: string | null;
  source: string | null;
  onSave: (sku: string, idea: string) => Promise<void>;
}) {
  const [v, setV] = useState(idea ?? "");
  // Re-sync when the server's idea changes under us — a try-again appends the note to it, and
  // a second reviewer can edit it. React's "adjust state during render" pattern rather than a
  // `key` on the parent: a remount would also throw away `saved`, so the "Saved" line could
  // never paint. Without either, the textarea keeps stale text and offers a "Save idea" button
  // that would write it back over the note.
  const [prevIdea, setPrevIdea] = useState(idea);
  if (idea !== prevIdea) {
    setPrevIdea(idea);
    setV(idea ?? "");
  }
  const [saved, formAction, isPending] = useActionState<boolean, FormData>(
    async () => {
      await onSave(sku, v);
      return true;
    },
    false,
  );
  // `updateIdea` trims before writing, so trailing whitespace is not an unsaved edit.
  const dirty = v.trim() !== (idea ?? "").trim();
  return (
    <form action={formAction} className="min-w-0 flex-1">
      <label htmlFor="idea" className="sr-only">
        Shot idea
      </label>
      <textarea
        id="idea"
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={2}
        maxLength={MAX_IDEA_CHARS}
        placeholder="Describe the scene for this product"
        aria-describedby={source === "suggested" ? "idea-source" : undefined}
        className="field-sizing-content w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-base leading-snug text-stone-900 placeholder:text-stone-600 hover:border-stone-300 focus:border-stone-300 focus:bg-white"
      />
      <div className="flex min-h-6 items-center gap-3 px-1 text-xs text-stone-600">
        {source === "suggested" && !dirty && (
          <span id="idea-source">Suggested. Edit if you like.</span>
        )}
        {dirty && (
          <button
            disabled={isPending}
            className="min-h-11 rounded-lg bg-stone-900 px-3 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save idea"}
          </button>
        )}
        {saved && !dirty && <span role="status">Saved</span>}
      </div>
    </form>
  );
}
