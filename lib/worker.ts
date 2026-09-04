// Advances generation and nothing else: submit queued candidates, poll processing ones,
// hand the notification decision to lib/notify.ts. Every branch here spends money or
// refuses to; the money-path numbers refer to the table in the plan.
import { db, st } from "./db";
import type { Candidate } from "./types";
import { env } from "./env";
import { storage } from "./storage";
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
    await submitQueued();
    await pollProcessing();
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
  const photos = new Map<string, string>(); // one fetch per SKU per tick
  for (const c of rows) {
    let jpegBase64 = photos.get(c.sku);
    if (jpegBase64 === undefined) {
      try {
        jpegBase64 = (await fetchPhoto(c.photo_url)).toString("base64");
        photos.set(c.sku, jpegBase64);
      } catch (e) {
        // Money path #12: nothing reached Luma, so cost stays 0. A host 5xx or timeout is
        // worth another tick; a 403 or a non-JPEG will read the same way forever.
        const retryable = e instanceof PhotoError ? e.retryable : true;
        if (retryable) bumpAttempt(c, reason(e));
        else fail(c.id, reason(e));
        continue;
      }
    }
    try {
      const gid = await submitEdit({ prompt: c.prompt, jpegBase64 });
      // Money is committed here, so cost is recorded here (Global Constraints, D7).
      d.prepare(
        `update candidates set state = ${st("processing")}, luma_generation_id = ?, attempts = attempts + 1, cost_usd = ? where id = ?`,
      ).run(gid, env.costPerImage, c.id);
    } catch (e) {
      if (e instanceof LumaRateLimitError) {
        state.nextSubmitAt = Date.now() + (e.retryAfterMs ?? 60_000);
        console.warn("worker:", e.userMessage);
        return; // candidate stays queued, attempts untouched
      }
      if (e instanceof LumaError && !e.retryable) {
        if (PAUSING_CODES.includes(e.code)) {
          pause(e.userMessage); // candidate stays queued at cost 0
          return;
        }
        // bad_request / not_found: the same request will fail the same way forever.
        fail(c.id, e.userMessage);
        continue;
      }
      bumpAttempt(c, reason(e));
    }
  }
}

async function pollProcessing() {
  const d = db();
  if (Date.now() < state.nextSubmitAt) return; // money path #5: a 429 window covers polls too
  const rows = d
    .prepare(
      `select * from candidates where state = ${st("processing")} and luma_generation_id is not null`,
    )
    .all() as Candidate[];
  for (const c of rows) {
    const gid = c.luma_generation_id;
    if (gid === null) continue; // unreachable: the query filters nulls
    try {
      const g = await getGeneration(gid);
      if (g.state === "failed") {
        // Cost stays: Luma's refund behaviour on failures is undocumented (D7).
        fail(
          c.id,
          g.failure?.userMessage ?? "Luma failed on its side. Try again.",
        );
        continue;
      }
      if (g.state !== "completed" || !g.url) continue;
      const res = await fetch(g.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        // Money path #7: the hour-long output URL expired. The candidate stays processing
        // so the next poll asks Luma for a fresh URL, but the attempts cap still applies:
        // a download that never succeeds must not be re-polled forever.
        console.warn(
          `download ${res.status} for candidate ${c.id}, re-polling`,
        );
        bumpAttempt(c, "Luma's image could not be downloaded. Try again.");
        continue;
      }
      storage.saveImage(c.id, Buffer.from(await res.arrayBuffer()));
      d.prepare(
        `update candidates set state = ${st("completed")} where id = ?`,
      ).run(c.id);
    } catch (e) {
      if (e instanceof LumaRateLimitError) {
        // The generation is already paid for; a 429 must not spend an attempt on it.
        state.nextSubmitAt = Date.now() + (e.retryAfterMs ?? 60_000);
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
          continue;
        }
      }
      // A paid generation must not be polled forever either: attempts end it too.
      bumpAttempt(c, reason(e));
    }
  }
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
