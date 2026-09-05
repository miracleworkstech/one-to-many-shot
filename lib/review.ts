// Decisions on a candidate. One responsibility: the approve/reject write.
import { db, inStates, st } from "./db";
import { MAX_SKU_CHARS, MAX_WHO_CHARS } from "./types";

export const DECISIONS = ["approved", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Narrows a form value without a cast: `.some` compares, `.includes` would demand the union. */
const isDecision = (v: string): v is Decision => DECISIONS.some((d) => d === v);

/**
 * Returns rows changed. The guards are the whole safety story: `state in (...)` means a
 * queued, processing or failed candidate cannot be decided (there is no image to judge),
 * and `sku = ?` means a forged id in the form cannot reach into another product's
 * candidates — the id and the SKU have to agree, and the SKU is the page you are on.
 * An unknown id changes nothing. Money path #10: two people deciding at once is
 * last-write-wins, both are humans and the card shows who decided.
 */
export function decideCandidate(
  id: number,
  state: Decision,
  who: string | null,
  sku: string,
): number {
  return db()
    .prepare(
      `update candidates set state=?, decided_by=?, decided_at=datetime('now')
       where id=? and sku=? and state in ${inStates("completed", "approved", "rejected")}`,
    )
    .run(state, who, id, sku).changes;
}

/** Archives a rejected candidate so it leaves the review carousel. Only a rejection can be
 *  archived (the image was seen and refused); the state stays "rejected", so nothing about
 *  counts, spend or exports changes. Returns rows changed. */
export function archiveCandidate(id: number, sku: string): number {
  return db()
    .prepare(
      `update candidates set archived_at=datetime('now')
       where id=? and sku=? and state=${st("rejected")} and archived_at is null`,
    )
    .run(id, sku).changes;
}

/** Input handling for `archive`: an id and the SKU of the page, both from a form. */
export function parseArchive(
  formData: FormData,
): { id: number; sku: string } | null {
  const id = Number(formData.get("id"));
  const sku = String(formData.get("sku") ?? "").trim();
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!sku || sku.length > MAX_SKU_CHARS) return null;
  return { id, sku };
}

/** The whole of the `decide` action's input handling, pure so it can be tested. Everything
 *  here arrives from a form a browser can forge: an id that is not a positive integer, a
 *  state that is not a decision and a missing or oversized SKU are all `null`, never a write.
 *  `who` is a display string, truncated rather than refused, and `null` when the form did
 *  not carry one: the UI names nobody (D20), so an absent name stays absent. */
export function parseDecision(
  formData: FormData,
): { id: number; state: Decision; who: string | null; sku: string } | null {
  const id = Number(formData.get("id"));
  const state = String(formData.get("state") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const who =
    String(formData.get("who") ?? "")
      .trim()
      .slice(0, MAX_WHO_CHARS) || null;
  if (!Number.isInteger(id) || id <= 0 || !isDecision(state)) return null;
  if (!sku || sku.length > MAX_SKU_CHARS) return null;
  return { id, state, who, sku };
}
