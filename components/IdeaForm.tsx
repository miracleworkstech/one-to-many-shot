"use client";
import { useActionState, useState } from "react";
import { MAX_IDEA_CHARS } from "@/lib/types";

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
    <form action={formAction} className="space-y-1">
      <label htmlFor="idea" className="block text-xs text-stone-500">
        Shot idea {source === "suggested" && "(suggested, edit if you like)"}
      </label>
      <textarea
        id="idea"
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={2}
        maxLength={MAX_IDEA_CHARS}
        className="w-full rounded border p-2 text-sm"
      />
      {dirty && (
        <button
          disabled={isPending}
          className="min-h-11 rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save idea"}
        </button>
      )}
      {saved && !dirty && (
        <p role="status" className="text-xs text-stone-500">
          Saved
        </p>
      )}
    </form>
  );
}
