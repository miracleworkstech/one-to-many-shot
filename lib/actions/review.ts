"use server";
import { revalidatePath } from "next/cache";
import { db, src } from "@/lib/db";

export async function updateIdea(sku: string, idea: string) {
  db()
    .prepare(
      `update products set shot_idea=?, shot_idea_source=${src("edited")}, updated_at=datetime('now') where sku=?`,
    )
    .run(idea.trim() || null, sku);
  revalidatePath("/");
  revalidatePath(`/review/${sku}`);
}
