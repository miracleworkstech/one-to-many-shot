import { db, src } from "./db";
import type { Product, ShotIdeaSource } from "./types";
import type { CatalogRow } from "./catalog";
import { suggestIdeas } from "./suggest";

// ponytail: split out of lib/actions/import.ts so it's testable without a Next
// request context (revalidatePath throws outside one). The action stays a thin
// "use server" wrapper around this. `suggest` defaults to the real suggestIdeas
// but is injectable so a test can simulate a race without hitting the network.
export async function importCatalogRows(
  rows: CatalogRow[],
  suggest: (products: Product[]) => Promise<Map<string, string>> = suggestIdeas,
) {
  if (!rows.length) return { imported: 0, suggested: 0 };
  const d = db();
  const upsert =
    d.prepare(`insert into products (sku,name,category,color,material,price,photo_url,shot_idea,shot_idea_source,notes,priority)
    values (@sku,@name,@category,@color,@material,@price,@photo_url,@shot_idea,@shot_idea_source,@notes,@priority)
    on conflict(sku) do update set name=excluded.name, category=excluded.category, color=excluded.color, material=excluded.material,
      price=excluded.price, photo_url=excluded.photo_url, notes=excluded.notes, priority=excluded.priority, updated_at=datetime('now'),
      shot_idea = case when excluded.shot_idea is not null then excluded.shot_idea else products.shot_idea end,
      shot_idea_source = case when excluded.shot_idea is not null then ${src("sheet")} else products.shot_idea_source end`);
  d.transaction(() => {
    for (const r of rows)
      upsert.run({
        ...r,
        priority: r.priority ? 1 : 0,
        shot_idea_source: r.shot_idea
          ? ("sheet" satisfies ShotIdeaSource)
          : null,
      });
  })();

  const blank = d
    .prepare("select * from products where shot_idea is null")
    .all() as Product[];
  const ideas = await suggest(blank);
  const setIdea = d.prepare(
    `update products set shot_idea=?, shot_idea_source=${src("suggested")} where sku=? and shot_idea is null`,
  );
  d.transaction(() => {
    for (const [sku, idea] of ideas) setIdea.run(idea, sku);
  })();
  return { imported: rows.length, suggested: ideas.size };
}
