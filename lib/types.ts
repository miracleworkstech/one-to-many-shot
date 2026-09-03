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
