// Advances generation and nothing else: submit queued candidates, poll processing ones,
// hand the notification decision to lib/notify.ts. Every branch here spends money or
// refuses to; the money-path numbers refer to the table in the plan.
import { db, st } from "./db";
import type { Candidate } from "./types";
import { env } from "./env";
import { storage } from "./storage";
import { reviewVariant } from "./images";
import { fetchPhoto, PhotoError } from "./photos";
import {
  submitEdit,
  getGeneration,
  LumaError,
  LumaRateLimitError,
} from "./luma";
import type { LumaErrorCode } from "./luma";
import { notifyIfBatchReady } from "./notify";

const MAX_ATTEMPTS = 5;
/** A human has to act (top up, fix the key, call Luma); retrying only burns attempts. */
const PAUSING_CODES: readonly LumaErrorCode[] = ["budget", "auth", "forbidden"];

declare global {
  var __shotsWorkerState:
    { running: boolean; nextSubmitAt: number } | undefined;
  var __shotsWorker: ReturnType<typeof setInterval> | undefined;
}

// ponytail: the single-flight lock and the 429 back-off deadline hang off globalThis like
// the database handle, because a dev hot reload leaves the old interval running against a
// fresh copy of this module: two module-local locks would submit the same queued row twice,
// and one image is paid for twice. One process, one lock.
const state = (globalThis.__shotsWorkerState ??= {
  running: false,
  nextSubmitAt: 0,
});

const reason = (e: unknown) =>
  e instanceof LumaError
    ? e.userMessage
    : e instanceof Error
      ? e.message
      : String(e);

const fail = (id: number, why: string) =>
  db()
    .prepare(
      `update candidates set state = ${st("failed")}, failure_reason = ? where id = ?`,
    )
    .run(why, id);

const pause = (why: string) => {
  db().prepare("update settings set paused_reason = ?").run(why);
  console.warn("worker paused:", why);
};

/** Money path #6: a retryable error costs an attempt; the fifth one ends the candidate. */
function bumpAttempt(c: Candidate, why: string) {
  const attempts = c.attempts + 1;
  if (attempts >= MAX_ATTEMPTS)
    db()
      .prepare(
        `update candidates set state = ${st("failed")}, failure_reason = ?, attempts = ? where id = ?`,
      )
      .run(why, attempts, c.id);
  else
    db()
      .prepare("update candidates set attempts = ? where id = ?")
      .run(attempts, c.id);
}

export async function tick() {
  if (state.running) return; // money path #2: single flight
  state.running = true;
  try {
    // Codex finding (poll-before-submit): poll first so a budget_exhausted result pauses the
    // worker before submitQueued spends on anything new this tick. The poll wave is parallel
    // (Task 21) but settles as a whole before submitQueued reads paused_reason, so the pause
    // from any one poll has landed before any new spend (race B).
    await pollProcessing();
    await submitQueued();
    await notifyIfBatchReady();
  } catch (e) {
    console.error("tick:", reason(e));
  } finally {
    state.running = false;
  }
}

async function submitQueued() {
  const d = db();
  const { paused_reason } = d
    .prepare("select paused_reason from settings")
    .get() as { paused_reason: string | null };
  if (paused_reason) return; // money path #4
  if (Date.now() < state.nextSubmitAt) return; // money path #5
  const inFlight = (
    d
      .prepare(
        `select count(*) as n from candidates where state = ${st("processing")}`,
      )
      .get() as { n: number }
  ).n;
  const slots = env.lumaConcurrency - inFlight;
  if (slots <= 0) return;
  const rows = d
    .prepare(
      `select c.*, p.photo_url from candidates c join products p on p.sku = c.sku
       where c.state = ${st("queued")} order by c.id limit ?`,
    )
    .all(slots) as (Candidate & { photo_url: string })[];
  // Race D: one fetch per SKU per tick. Two candidates of one SKU await the same promise,
  // so the host is hit once even though both submit concurrently.
  const photos = new Map<string, Promise<string>>();
  const photoFor = (c: Candidate & { photo_url: string }) => {
    let p = photos.get(c.sku);
    if (!p) {
      p = fetchPhoto(c.photo_url).then((b) => b.toString("base64"));
      photos.set(c.sku, p);
    }
    return p;
  };
  // At most `slots` submissions in flight at once, and slots <= LUMA_CONCURRENCY.
  settle(await Promise.allSettled(rows.map((c) => submitOne(c, photoFor(c)))));
}

/** One queued candidate, start to finish. Never throws: a sibling's failure is its own. */
async function submitOne(
  c: Candidate,
  jpegBase64Promise: Promise<string>,
): Promise<void> {
  let jpegBase64: string;
  try {
    jpegBase64 = await jpegBase64Promise;
  } catch (e) {
    // Money path #12: nothing reached Luma, so cost stays 0. A host 5xx or timeout is
    // worth another tick; a 403 or a non-JPEG will read the same way forever.
    const retryable = e instanceof PhotoError ? e.retryable : true;
    if (retryable) bumpAttempt(c, reason(e));
    else fail(c.id, reason(e));
    return;
  }
  // Guard for races A and C: while this candidate waited on its photo, a sibling may have
  // paused the worker (402/401/403) or hit a 429. Those races let Luma calls already in
  // flight finish; they do not allow a new one to start. Re-read both and stop here, leaving
  // the candidate queued with attempts and cost untouched.
  const { paused_reason } = db()
    .prepare("select paused_reason from settings")
    .get() as { paused_reason: string | null };
  if (paused_reason || Date.now() < state.nextSubmitAt) return;
  try {
    const gid = await submitEdit({ prompt: c.prompt, jpegBase64 });
    // Money is committed here, so cost is recorded here (Global Constraints, D7).
    // submitted_at: the same statement, so the stamp lands with the money (Task 22).
    db()
      .prepare(
        `update candidates set state = ${st("processing")}, luma_generation_id = ?, attempts = attempts + 1, cost_usd = ?, submitted_at = datetime('now') where id = ?`,
      )
      .run(gid, env.costPerImage, c.id);
  } catch (e) {
    if (e instanceof LumaRateLimitError) {
      // Race C: the deadline covers the next tick; siblings already in flight finish on
      // their own, and a sibling that also 429s spends no attempt either. Max, not assign:
      // a sibling's shorter Retry-After landing later must not cut an earlier, longer one.
      state.nextSubmitAt = Math.max(
        state.nextSubmitAt,
        Date.now() + (e.retryAfterMs ?? 60_000),
      );
      console.warn("worker:", e.userMessage);
      return; // candidate stays queued, attempts untouched
    }
    if (e instanceof LumaError && !e.retryable) {
      if (PAUSING_CODES.includes(e.code)) {
        // Race A: this candidate stays queued at cost 0. Siblings in the same wave either
        // got a real accepted job (charged, with its id), their own 402 (queued, cost 0),
        // or were still fetching a photo and never submitted (the guard above; queued, cost 0).
        // Several 402s in one wave each call pause(): the update is idempotent, so the
        // worker is simply left paused; the log line repeats once per call.
        pause(e.userMessage);
        return;
      }
      // bad_request / not_found: the same request will fail the same way forever.
      fail(c.id, e.userMessage);
      return;
    }
    bumpAttempt(c, reason(e));
  }
}

async function pollProcessing() {
  if (Date.now() < state.nextSubmitAt) return; // money path #5: a 429 window covers polls too
  const rows = db()
    .prepare(
      `select * from candidates where state = ${st("processing")} and luma_generation_id is not null`,
    )
    .all() as Candidate[];
  // ponytail: the whole wave at once. Processing rows number at most LUMA_CONCURRENCY (slots
  // come from it), so this is at most that many downloads in memory; a semaphore if the
  // cap ever grows past a handful.
  settle(await Promise.allSettled(rows.map(pollOne)));
}

/** One processing candidate, start to finish. Never throws: a sibling's failure is its own. */
async function pollOne(c: Candidate): Promise<void> {
  const gid = c.luma_generation_id;
  if (gid === null) return; // unreachable: the query filters nulls
  try {
    const g = await getGeneration(gid);
    if (g.state === "failed") {
      // Cost stays: Luma's refund behaviour on failures is undocumented (D7).
      fail(
        c.id,
        g.failure?.userMessage ?? "Luma failed on its side. Try again.",
      );
      // Money path #4: credits ran out mid-generation. Siblings in this wave are already
      // paid for and finish on their own; the pause lands before submitQueued reads it
      // (race B), so nothing new is bought this tick.
      if (g.failure?.code === "budget_exhausted") pause(g.failure.userMessage);
      return;
    }
    if (g.state !== "completed" || !g.url) return;
    const res = await fetch(g.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      // Money path #7: the hour-long output URL expired. The candidate stays processing
      // so the next poll asks Luma for a fresh URL, but the attempts cap still applies:
      // a download that never succeeds must not be re-polled forever.
      console.warn(`download ${res.status} for candidate ${c.id}, re-polling`);
      bumpAttempt(c, "Luma's image could not be downloaded. Try again.");
      return;
    }
    const original = Buffer.from(await res.arrayBuffer());
    storage.saveImage(c.id, original);
    // The review copy is a convenience, not the record: if the resize fails the page
    // serves the original (storage.readReview falls back) and the candidate still lands.
    try {
      storage.saveReview(c.id, await reviewVariant(original));
    } catch (e) {
      console.warn(`review copy for candidate ${c.id} skipped: ${reason(e)}`);
    }
    db()
      .prepare(
        `update candidates set state = ${st("completed")}, completed_at = datetime('now') where id = ?`,
      )
      .run(c.id);
    logCompleted(c.id);
  } catch (e) {
    if (e instanceof LumaRateLimitError) {
      // The generation is already paid for; a 429 must not spend an attempt on it. The
      // deadline covers the next tick's polls and submits (race C); max, not assign, so a
      // sibling's shorter Retry-After landing later keeps the longer window.
      state.nextSubmitAt = Math.max(
        state.nextSubmitAt,
        Date.now() + (e.retryAfterMs ?? 60_000),
      );
      console.warn("worker:", e.userMessage);
      return;
    }
    if (e instanceof LumaError && !e.retryable) {
      if (PAUSING_CODES.includes(e.code)) {
        pause(e.userMessage);
        return;
      }
      if (e.code === "not_found") {
        fail(c.id, e.userMessage); // Luma forgot the generation; polling it again is free but pointless
        return;
      }
    }
    // A paid generation must not be polled forever either: attempts end it too.
    bumpAttempt(c, reason(e));
  }
}

/** The one `console.log` in the worker (the rest are warn/error). One JSON line per landed
 *  image; the field names are the contract a Railway log filter matches on:
 *  `event`, `candidateId`, `batchId`, `sku`, `lumaMs`, `costUsd`. `lumaMs` is
 *  completed_at - submitted_at computed by SQLite (the same julianday expression as
 *  lib/analytics.ts: the stamps are SQLite's own datetime('now') strings, so SQLite parses
 *  them back without a timezone guess in JS). Second resolution, so it is a multiple of
 *  1000; null for a row stamped before Task 22's columns existed. */
function logCompleted(id: number) {
  const r = db()
    .prepare(
      `select id as candidateId, batch_id as batchId, sku, cost_usd as costUsd,
         round((julianday(completed_at) - julianday(submitted_at)) * 86400000) as lumaMs
       from candidates where id = ?`,
    )
    .get(id) as {
    candidateId: number;
    batchId: number;
    sku: string;
    costUsd: number;
    lumaMs: number | null;
  };
  console.log(JSON.stringify({ event: "candidate_completed", ...r }));
}

/** pollOne and submitOne never throw, so a rejection here is a bug; log it like tick() does. */
function settle(results: PromiseSettledResult<void>[]) {
  for (const r of results)
    if (r.status === "rejected") console.error("tick:", reason(r.reason));
}

/** Idempotent: Next can call instrumentation's register more than once in a process. */
export function startWorker() {
  if (globalThis.__shotsWorker) return;
  const stuck = (
    db()
      .prepare(
        `select count(*) as n from candidates where state = ${st("queued")} and attempts > 0`,
      )
      .get() as { n: number }
  ).n;
  if (stuck)
    console.warn(
      `worker: ${stuck} candidate(s) were mid-submit at last shutdown; they will be resubmitted (money path #3)`,
    );
  globalThis.__shotsWorker = setInterval(() => void tick(), env.tickMs);
}
