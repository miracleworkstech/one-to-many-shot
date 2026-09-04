export const CANDIDATE_STATES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "approved",
  "rejected",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const BATCH_KINDS = ["next", "product", "retry"] as const;
export type BatchKind = (typeof BATCH_KINDS)[number];

export const SHOT_IDEA_SOURCES = ["sheet", "suggested", "edited"] as const;
export type ShotIdeaSource = (typeof SHOT_IDEA_SOURCES)[number];

export interface Product {
  sku: string;
  name: string;
  category: string;
  color: string;
  material: string;
  price: string;
  photo_url: string;
  shot_idea: string | null;
  shot_idea_source: ShotIdeaSource | null;
  notes: string;
  priority: number;
  imported_at: string;
  updated_at: string;
}
export interface Batch {
  id: number;
  kind: BatchKind;
  estimated_usd: number;
  created_at: string;
}
export interface Candidate {
  id: number;
  sku: string;
  batch_id: number;
  prompt: string;
  luma_generation_id: string | null;
  state: CandidateState;
  cost_usd: number;
  failure_reason: string | null;
  attempts: number;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Free-text limits at the trust boundary. They live here, not in `lib/review.ts` or
 *  `lib/enqueue.ts`, because both of those import `lib/db.ts` (better-sqlite3) and the
 *  textarea that enforces `maxLength` is a client component. A shot idea is one sentence;
 *  500 characters is generous. A name on a decision is a name. The catalog's SKUs are
 *  `HG-002`-shaped, so 64 is already far past anything real. */
export const MAX_IDEA_CHARS = 500;
export const MAX_WHO_CHARS = 80;
export const MAX_SKU_CHARS = 64;
