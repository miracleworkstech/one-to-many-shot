// Admission control: the only place candidates are created. Refuses past the two caps
// (money paths #1 and #8) and skips products that already have work in flight.
import { db, st, inStates, src } from "./db";
import { MAX_IDEA_CHARS, type Product, type BatchKind } from "./types";
import { env } from "./env";
import { buildPrompt } from "./prompt";

export interface EnqueueResult {
  batchId?: number;
  queued: number;
  skipped: string[];
  estimatedUsd: number;
  refused?: string;
}

/** A product we can actually generate for: the SQL filters nulls, this makes the compiler agree. */
type Generatable = Product & { shot_idea: string };

export function enqueue(
  skus: string[],
  kind: BatchKind,
  opts: { perProduct?: number } = {},
): EnqueueResult {
  const per = opts.perProduct ?? env.candidatesPerProduct;
  const d = db();
  return d.transaction((): EnqueueResult => {
    // Processing candidates already carry their cost in `spent`; queued ones cost nothing
    // yet but will, so only they are reserved against the budget.
    const flight = d
      .prepare(
        `select count(*) as inFlight, coalesce(sum(state = ${st("queued")}), 0) as queued
         from candidates where state in ${inStates("queued", "processing")}`,
      )
      .get() as { inFlight: number; queued: number };
    const spent = (
      d
        .prepare("select coalesce(sum(cost_usd),0) as s from candidates")
        .get() as {
        s: number;
      }
    ).s;
    const busy = new Set(
      (
        d
          .prepare(
            `select distinct sku from candidates where state in ${inStates("queued", "processing")}`,
          )
          .all() as { sku: string }[]
      ).map((r) => r.sku),
    );
    const found = skus.length
      ? (d
          .prepare(
            `select * from products where sku in (${skus.map(() => "?").join(",")})`,
          )
          .all(...skus) as Product[])
      : [];
    const targets = found.filter(
      (p): p is Generatable => !!p.shot_idea && !busy.has(p.sku),
    );
    const skipped = skus.filter((s) => !targets.some((p) => p.sku === s));
    const planned = targets.length * per;
    const estimatedUsd = planned * env.costPerImage;
    if (planned === 0) return { queued: 0, skipped, estimatedUsd: 0 };
    if (flight.inFlight + planned > env.maxInFlight)
      return {
        queued: 0,
        skipped,
        estimatedUsd,
        refused: `${flight.inFlight} images already in flight; adding ${planned} would exceed the ${env.maxInFlight} in-flight cap. Wait for the current batch.`,
      };
    if (
      spent + flight.queued * env.costPerImage + estimatedUsd >
      env.maxTotalSpend
    )
      return {
        queued: 0,
        skipped,
        estimatedUsd,
        refused: `This would take total spend past the $${env.maxTotalSpend} budget cap (spent $${spent.toFixed(2)}). Raise MAX_TOTAL_SPEND_USD to continue.`,
      };
    const batchId = Number(
      d
        .prepare("insert into batches (kind, estimated_usd) values (?, ?)")
        .run(kind, estimatedUsd).lastInsertRowid,
    );
    const ins = d.prepare(
      "insert into candidates (sku, batch_id, prompt, shot_idea) values (?, ?, ?, ?)",
    );
    for (const p of targets)
      for (let i = 0; i < per; i++)
        ins.run(p.sku, batchId, buildPrompt(p, p.shot_idea), p.shot_idea);
    return { batchId, queued: planned, skipped, estimatedUsd };
  })();
}

/** Next N products by priority that have an idea and nothing in flight, completed or approved yet. */
export function nextSkus(n: number): string[] {
  return (
    db()
      .prepare(
        `select p.sku from products p where p.shot_idea is not null
        and not exists (select 1 from candidates c where c.sku = p.sku and c.state in ${inStates("queued", "processing", "completed", "approved")})
        order by p.priority desc, p.sku limit ?`,
      )
      .all(n) as { sku: string }[]
  ).map((r) => r.sku);
}

/**
 * "Try again" with a note. The note has to join the shot idea *before* `enqueue` runs,
 * because `enqueue` builds each candidate's prompt from the idea as it stands — so the
 * write happens first and is rolled back inside the same transaction when nothing was
 * queued. A refusal (a cap) or a skip (already generating) must not leave Ellie's idea
 * permanently rewritten for a batch that never existed.
 */
export function enqueueRetry(sku: string, note: string): EnqueueResult {
  const d = db();
  return d.transaction((): EnqueueResult => {
    const trimmed = note.trim();
    const row = trimmed
      ? (d
          .prepare(
            "select shot_idea, shot_idea_source, updated_at from products where sku = ?",
          )
          .get(sku) as
          | Pick<Product, "shot_idea" | "shot_idea_source" | "updated_at">
          | undefined)
      : undefined;
    // Only a product that exists and already has an idea can carry a note. Without an idea
    // there is nothing to append to and `enqueue` would skip the product anyway, so writing
    // the bare note as the idea would invent one nobody asked for.
    const before = row?.shot_idea ? row : undefined;
    if (before)
      d.prepare(
        `update products set shot_idea = ?, shot_idea_source = ${src("edited")}, updated_at = datetime('now') where sku = ?`,
      ).run(`${before.shot_idea}, ${trimmed}`.slice(0, MAX_IDEA_CHARS), sku);
    const result = enqueue([sku], "retry");
    if (before && result.queued === 0)
      d.prepare(
        "update products set shot_idea = ?, shot_idea_source = ?, updated_at = ? where sku = ?",
      ).run(before.shot_idea, before.shot_idea_source, before.updated_at, sku);
    return result;
  })();
}
