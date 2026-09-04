"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";
import { decideCandidate, parseDecision } from "@/lib/review";
import { MAX_IDEA_CHARS } from "@/lib/types";

export async function updateIdea(sku: string, idea: string) {
  db()
    .prepare(
      `update products set shot_idea=?, shot_idea_source=${src("edited")}, updated_at=datetime('now') where sku=?`,
    )
    .run(idea.trim().slice(0, MAX_IDEA_CHARS) || null, sku);
  revalidatePath("/");
  revalidatePath(`/review/${sku}`);
}

/** Glue only: parse the form, delegate the write, revalidate. */
export async function decide(formData: FormData) {
  const d = parseDecision(formData);
  if (!d) return;
  decideCandidate(d.id, d.state, d.who, d.sku);
  revalidatePath("/");
  revalidatePath(`/review/${d.sku}`);
}
