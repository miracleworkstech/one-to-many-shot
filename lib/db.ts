import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import {
  CANDIDATE_STATES,
  BATCH_KINDS,
  SHOT_IDEA_SOURCES,
  type CandidateState,
  type ShotIdeaSource,
} from "./types";

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

/** Typed SQL literals. A misspelled state in a query or an assignment is a compile error, not a silent miss. */
export const st = (s: CandidateState) => `'${s}'`;
export const inStates = (...s: CandidateState[]) => `(${s.map(st).join(",")})`;
export const src = (s: ShotIdeaSource) => `'${s}'`;

export const SCHEMA = `
create table if not exists products (
  sku text primary key, name text not null, category text not null default '',
  color text not null default '', material text not null default '', price text not null default '',
  photo_url text not null, shot_idea text, shot_idea_source text check (shot_idea_source is null or shot_idea_source in (${list(SHOT_IDEA_SOURCES)})),
  notes text not null default '', priority integer not null default 0,
  imported_at text not null default (datetime('now')), updated_at text not null default (datetime('now'))
);
create table if not exists batches (
  id integer primary key autoincrement, kind text not null check (kind in (${list(BATCH_KINDS)})), estimated_usd real not null default 0,
  created_at text not null default (datetime('now'))
);
create table if not exists candidates (
  id integer primary key autoincrement, sku text not null references products(sku),
  batch_id integer not null references batches(id),
  prompt text not null, luma_generation_id text, state text not null default ${st("queued")} check (state in (${list(CANDIDATE_STATES)})),
  shot_idea text,
  archived_at text,
  cost_usd real not null default 0, failure_reason text, attempts integer not null default 0,
  decided_by text, created_at text not null default (datetime('now')), decided_at text
);
create index if not exists candidates_sku on candidates(sku);
create index if not exists candidates_state on candidates(state);
create index if not exists candidates_batch on candidates(batch_id);
create table if not exists settings (
  id integer primary key check (id = 1), paused_reason text, last_notified_at text,
  last_notified_id integer not null default 0
);
insert or ignore into settings (id) values (1);
`;

declare global {
  var __shotsDb: Database.Database | undefined;
}

export function db(): Database.Database {
  if (globalThis.__shotsDb) return globalThis.__shotsDb;
  fs.mkdirSync(env.dataDir, { recursive: true });
  const d = new Database(path.join(env.dataDir, "app.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  // `create table if not exists` cannot add a column to a database that already exists
  // (a running deploy's volume). ponytail: two additive columns, inline; a migrations
  // table the day there is a third one.
  const settingsCols = (
    d.prepare("pragma table_info(settings)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!settingsCols.includes("last_notified_id"))
    d.exec(
      "alter table settings add column last_notified_id integer not null default 0",
    );
  const candidateCols = (
    d.prepare("pragma table_info(candidates)").all() as { name: string }[]
  ).map((c) => c.name);
  // A rejected candidate can be archived to leave the review carousel (2026-09-05). Additive,
  // like shot_idea: the state stays "rejected" so counts, spend and exports do not change.
  if (!candidateCols.includes("archived_at"))
    d.exec("alter table candidates add column archived_at text");
  if (!candidateCols.includes("shot_idea"))
    // One transaction: a crash after the alter but before the backfill would otherwise
    // leave the column present and the backfill skipped forever (Codex, Task 8d).
    d.transaction(() => {
      d.exec("alter table candidates add column shot_idea text");
      // Backfill for rows generated before this column existed: the product's current idea
      // is the best available guess (the idea the candidate was actually generated with is
      // gone), so pre-existing candidates fall back to it via `c.shot_idea ?? p.shot_idea`
      // anyway. This one-time update just saves that lookup for future rows.
      d.exec(
        "update candidates set shot_idea = (select shot_idea from products where products.sku = candidates.sku) where shot_idea is null",
      );
    })();
  globalThis.__shotsDb = d;
  return d;
}
