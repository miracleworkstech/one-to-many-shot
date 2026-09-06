import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Candidate, CandidateState } from "../lib/types.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-worker-"));
process.env.DATA_DIR = dir;
process.env.LUMA_AGENTS_API_KEY = "test-key-abc123"; // fake; nothing here reaches the network
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/services/T/B/X";
process.env.APP_URL = "https://shots.example.test";
process.env.ACCESS_TOKEN = "t0ken";
process.env.WORKER_TICK_MS = "3600000"; // startWorker is never called; this is belt and braces

const { db } = await import("../lib/db.ts");
const { env } = await import("../lib/env.ts");
const { storage } = await import("../lib/storage.ts");
const { tick } = await import("../lib/worker.ts");
const { nextSkus } = await import("../lib/enqueue.ts");
const { notifyIfBatchReady } = await import("../lib/notify.ts");

const d = db();
after(() => {
  d.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const PHOTO =
  "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-002.jpg";
const OUTPUT = "https://storage.lumalabs.test/out/gen.jpg";
const SLACK = "https://hooks.slack.test/services/T/B/X";
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

type Reply = {
  status?: number;
  body?: string | Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
};
type Handler = (
  url: string,
  init: RequestInit | undefined,
) => Reply | Promise<Reply>;

let calls: { url: string; init?: RequestInit }[] = [];
let unexpected: string[] = [];

/** Answers the photo host, the Luma API and the Slack webhook by URL. Never the network. */
function stubFetch(handler: Handler) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const r = await handler(url, init); // async handlers stand in for a slow host
    return new Response(r.body ?? "{}", {
      status: r.status ?? 200,
      headers: r.headers,
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const miss = (url: string): Reply => {
  unexpected.push(url);
  return { status: 599, body: JSON.stringify({ detail: "unexpected call" }) };
};
const isSubmit = (url: string, init: RequestInit | undefined) =>
  url === "https://agents.lumalabs.ai/v1/generations" &&
  init?.method === "POST";
const lumaCalls = () =>
  calls.filter((c) => c.url.startsWith("https://agents.lumalabs.ai"));

function reset() {
  d.exec(
    "delete from candidates; delete from batches; delete from products;" +
      " update settings set paused_reason = null, last_notified_at = null, last_notified_id = 0;",
  );
  // The 429 back-off deadline is process-global by design (lib/worker.ts), so clear it
  // between tests; otherwise one test's Retry-After window silently voids the next.
  const worker = globalThis.__shotsWorkerState;
  if (worker) worker.nextSubmitAt = 0;
  calls = [];
  unexpected = [];
}

function seedProduct(
  sku = "HG-002",
  priority = 0,
  idea: string | null = "morning kitchen counter, steam, warm light",
) {
  d.prepare(
    "insert into products (sku,name,photo_url,shot_idea,priority) values (?,?,?,?,?)",
  ).run(sku, "Stoneware Mug 12oz", PHOTO, idea, priority);
}

function seedCandidate(
  opts: {
    sku?: string;
    state?: CandidateState;
    gid?: string | null;
    cost?: number;
    attempts?: number;
  } = {},
): number {
  const batch = d
    .prepare("insert into batches (kind, estimated_usd) values ('next', 0.09)")
    .run().lastInsertRowid;
  return Number(
    d
      .prepare(
        "insert into candidates (sku,batch_id,prompt,state,luma_generation_id,cost_usd,attempts) values (?,?,?,?,?,?,?)",
      )
      .run(
        opts.sku ?? "HG-002",
        batch,
        "Place this exact Stoneware Mug 12oz in this scene: morning kitchen counter.",
        opts.state ?? "queued",
        opts.gid ?? null,
        opts.cost ?? 0,
        opts.attempts ?? 0,
      ).lastInsertRowid,
  );
}

const row = (id: number) =>
  d.prepare("select * from candidates where id = ?").get(id) as Candidate;
const pausedReason = () =>
  (
    d.prepare("select paused_reason from settings").get() as {
      paused_reason: string | null;
    }
  ).paused_reason;

test("(1) a submitted candidate is charged at once, then the finished image lands", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  let polls = 0;
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return { body: JSON.stringify({ id: "gen-1", state: "queued" }) };
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-1")
      return {
        body: JSON.stringify(
          ++polls === 1
            ? { id: "gen-1", state: "processing" }
            : { id: "gen-1", state: "completed", output: [{ url: OUTPUT }] },
        ),
      };
    if (url === OUTPUT) return { body: JPEG };
    if (url === SLACK) return { body: "ok" };
    return miss(url);
  });
  try {
    await tick();
    let c = row(id);
    assert.equal(c.state, "processing");
    assert.equal(c.cost_usd, env.costPerImage);
    assert.equal(c.luma_generation_id, "gen-1");
    assert.equal(c.attempts, 1);

    const submit = calls.find((x) => isSubmit(x.url, x.init));
    const sent = JSON.parse(String(submit?.init?.body)) as {
      prompt: string;
      source: { data: string; media_type: string };
    };
    assert.match(sent.prompt, /Stoneware Mug 12oz/);
    assert.equal(sent.source.data, Buffer.from(JPEG).toString("base64"));

    // Poll now runs before submit (Codex finding: poll-before-submit), so a candidate
    // submitted THIS tick is not polled until the NEXT tick — one extra tick is needed
    // before the "processing" mock response is even reachable.
    await tick();
    c = row(id);
    assert.equal(
      c.state,
      "processing",
      "submitted this tick, polled next tick",
    );
    assert.equal(c.cost_usd, env.costPerImage);

    await tick();
    c = row(id);
    assert.equal(c.state, "completed");
    assert.equal(c.cost_usd, env.costPerImage);
    assert.ok(storage.readImage(id), "the image is on disk");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(2) 402 pauses the worker, leaves the candidate queued at cost 0, and stops submitting", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return {
        status: 402,
        body: JSON.stringify({ detail: "insufficient balance" }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "queued");
    assert.equal(c.cost_usd, 0);
    assert.equal(c.attempts, 0);
    assert.equal(
      pausedReason(),
      "Luma has no credits left. Add funds, then press Resume.",
    );
    const before = calls.length;
    await tick();
    assert.equal(calls.length, before, "a paused worker calls nothing");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(3) 401 pauses with the bad-key message", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return { status: 401, body: JSON.stringify({ detail: "invalid key" }) };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(row(id).state, "queued");
    assert.equal(
      pausedReason(),
      "Luma rejected the API key. Fix LUMA_AGENTS_API_KEY, then press Resume.",
    );
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(5) five upstream errors end the candidate, still at cost 0", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return { status: 503, body: JSON.stringify({ detail: "unavailable" }) };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(row(id).attempts, 1);
    assert.equal(row(id).state, "queued");
    for (let i = 0; i < 4; i++) await tick();
    const c = row(id);
    assert.equal(c.attempts, 5);
    assert.equal(c.state, "failed");
    assert.equal(
      c.failure_reason,
      "Luma is temporarily unavailable. Retrying.",
    );
    assert.equal(c.cost_usd, 0);
    assert.equal(pausedReason(), null, "a 5xx is not a pause");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(6) an unreachable photo fails the candidate before any money is spent", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url) => {
    if (url === PHOTO) return { status: 403, body: "forbidden" };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "failed");
    assert.equal(c.failure_reason, "photo not reachable (HTTP 403)");
    assert.equal(c.cost_usd, 0);
    assert.equal(lumaCalls().length, 0, "Luma was never called");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(6b) a photo host 5xx spends an attempt and calls Luma not at all", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url) => {
    if (url === PHOTO) return { status: 503, body: "busy" };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "queued", "the host may be back on the next tick");
    assert.equal(c.attempts, 1);
    assert.equal(c.cost_usd, 0);
    assert.equal(lumaCalls().length, 0);
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(7) a moderated generation fails with Luma's reason and keeps its cost", async () => {
  reset();
  seedProduct();
  const id = seedCandidate({
    state: "processing",
    gid: "gen-7",
    cost: env.costPerImage,
    attempts: 1,
  });
  const restore = stubFetch((url) => {
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-7")
      return {
        body: JSON.stringify({
          id: "gen-7",
          state: "failed",
          failure_code: "content_moderated",
          failure_reason: "blocked by policy",
        }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "failed");
    assert.equal(
      c.failure_reason,
      "Luma's moderation blocked this prompt or photo. Edit the idea and try again.",
    );
    assert.equal(
      c.cost_usd,
      env.costPerImage,
      "an image we paid for stays paid",
    );
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(7b) a budget_exhausted failure while polling pauses the worker and stops the tick", async () => {
  reset();
  seedProduct("HG-002", 0);
  const failing = seedCandidate({
    sku: "HG-002",
    state: "processing",
    gid: "gen-7b",
    cost: env.costPerImage,
    attempts: 1,
  });
  const restore = stubFetch((url) => {
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-7b")
      return {
        body: JSON.stringify({
          id: "gen-7b",
          state: "failed",
          failure_code: "budget_exhausted",
          failure_reason: "out of credits",
        }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(failing);
    assert.equal(c.state, "failed");
    assert.equal(
      c.failure_reason,
      "Luma ran out of credits during this generation. Add funds, then press Resume.",
    );
    assert.equal(
      c.cost_usd,
      env.costPerImage,
      "an image we paid for stays paid",
    );
    assert.equal(
      pausedReason(),
      "Luma ran out of credits during this generation. Add funds, then press Resume.",
    );
    assert.deepEqual(unexpected, []);

    // A second candidate queued after the pause: the next tick must not submit it either.
    seedProduct("HG-003", 0);
    const queued = seedCandidate({ sku: "HG-003", state: "queued" });
    const before = calls.length;
    await tick();
    assert.equal(calls.length, before, "a paused worker calls nothing");
    assert.equal(row(queued).state, "queued");
    assert.equal(row(queued).cost_usd, 0);
  } finally {
    restore();
  }
});

test("(7c) budget_exhausted while polling pauses before a same-tick queued candidate is submitted", async () => {
  reset();
  seedProduct("HG-002", 0);
  const failing = seedCandidate({
    sku: "HG-002",
    state: "processing",
    gid: "gen-7c-a",
    cost: env.costPerImage,
    attempts: 1,
  });
  // A second processing candidate polled in the same wave (Task 21: the poll wave is
  // parallel, so the pause no longer stops siblings already in flight; race B). Its reply is
  // "still processing", so it must come out untouched: same state, same attempts, no cost
  // change. The row that matters for money is the queued one below.
  seedProduct("HG-003", 0);
  const untouched = seedCandidate({
    sku: "HG-003",
    state: "processing",
    gid: "gen-7c-b",
    cost: env.costPerImage,
    attempts: 1,
  });
  seedProduct("HG-004", 0);
  const queued = seedCandidate({ sku: "HG-004", state: "queued" });
  const restore = stubFetch((url) => {
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-7c-a")
      return {
        body: JSON.stringify({
          id: "gen-7c-a",
          state: "failed",
          failure_code: "budget_exhausted",
          failure_reason: "out of credits",
        }),
      };
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-7c-b")
      return { body: JSON.stringify({ id: "gen-7c-b", state: "processing" }) };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(row(failing).state, "failed");
    assert.equal(
      pausedReason(),
      "Luma ran out of credits during this generation. Add funds, then press Resume.",
    );
    const b = row(untouched);
    assert.equal(b.state, "processing");
    assert.equal(b.attempts, 1);
    assert.equal(b.cost_usd, env.costPerImage);
    // Poll-before-submit (Codex finding): the whole poll wave settles, so the pause has
    // landed before submitQueued reads paused_reason. The queued row stays queued at cost 0
    // and the Luma submit endpoint is never called. This is what kills the "drop the
    // pause() in pollOne" mutant: without it the queued row would be submitted this tick.
    const c = row(queued);
    assert.equal(c.state, "queued");
    assert.equal(c.cost_usd, 0);
    assert.equal(lumaCalls().filter((x) => isSubmit(x.url, x.init)).length, 0);
    assert.equal(
      calls.filter((x) => x.url === PHOTO).length,
      0,
      "no photo is fetched for a row that will not be submitted",
    );
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(8) an expired output URL is re-polled, but not forever", async () => {
  reset();
  seedProduct();
  const id = seedCandidate({
    state: "processing",
    gid: "gen-8",
    cost: env.costPerImage,
    attempts: 1,
  });
  const restore = stubFetch((url) => {
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-8")
      return {
        body: JSON.stringify({
          id: "gen-8",
          state: "completed",
          output: [{ url: OUTPUT }],
        }),
      };
    if (url === OUTPUT) return { status: 403, body: "expired" };
    return miss(url);
  });
  try {
    await tick();
    let c = row(id);
    assert.equal(c.state, "processing", "a fresh URL is worth another poll");
    assert.equal(c.attempts, 2);
    assert.equal(c.cost_usd, env.costPerImage);
    assert.equal(storage.readImage(id), null);

    for (let i = 0; i < 4; i++) await tick();
    c = row(id);
    assert.equal(c.state, "failed");
    assert.equal(c.attempts, 5);
    assert.equal(
      c.failure_reason,
      "Luma's image could not be downloaded. Try again.",
    );
    assert.equal(c.cost_usd, env.costPerImage, "the image was paid for");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(9) overlapping ticks submit a queued candidate once", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return { body: JSON.stringify({ id: "gen-9", state: "queued" }) };
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-9")
      return { body: JSON.stringify({ id: "gen-9", state: "processing" }) };
    return miss(url);
  });
  try {
    const first = tick();
    const second = tick(); // fires while the first is awaiting the photo
    await Promise.all([first, second]);
    assert.equal(
      calls.filter((c) => isSubmit(c.url, c.init)).length,
      1,
      "one candidate, one paid submit",
    );
    assert.equal(row(id).cost_usd, env.costPerImage);
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(10) nextSkus takes priority first and skips products already spoken for", () => {
  reset();
  seedProduct("HG-001", 0);
  seedProduct("HG-002", 5);
  seedProduct("HG-003", 9, null); // no idea
  seedProduct("HG-004", 8);
  seedProduct("HG-005", 7);
  seedProduct("HG-006", 6);
  seedCandidate({ sku: "HG-004", state: "completed" });
  seedCandidate({ sku: "HG-005", state: "queued" });
  seedCandidate({ sku: "HG-006", state: "approved" });
  assert.deepEqual(nextSkus(10), ["HG-002", "HG-001"]);
  assert.deepEqual(nextSkus(1), ["HG-002"]);
});

test("(11) one Slack message per settled batch", async () => {
  reset();
  seedProduct("HG-002");
  seedProduct("HG-003");
  const posts: string[] = [];
  const restore = stubFetch((url, init) => {
    if (url === SLACK) {
      posts.push(String(init?.body));
      return { body: "ok" };
    }
    return miss(url);
  });
  try {
    seedCandidate({ sku: "HG-002", state: "completed" });
    await notifyIfBatchReady();
    assert.equal(posts.length, 1);
    assert.match(
      posts[0] ?? "",
      /1 product has new shots to approve or reject/,
    );
    assert.match(posts[0] ?? "", /https:\/\/shots.example.test\/next\?k=t0ken/);

    await notifyIfBatchReady();
    assert.equal(posts.length, 1, "nothing new completed");

    seedCandidate({ sku: "HG-003", state: "completed" });
    await notifyIfBatchReady();
    assert.equal(posts.length, 2);
    assert.match(
      posts[1] ?? "",
      /2 products have new shots to approve or reject/,
    );

    seedCandidate({ sku: "HG-002", state: "queued" });
    seedCandidate({ sku: "HG-002", state: "completed" });
    await notifyIfBatchReady();
    assert.equal(posts.length, 2, "the batch has not settled yet");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(3b) 403 pauses with the suspended-client message", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return { status: 403, body: JSON.stringify({ detail: "suspended" }) };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "queued");
    assert.equal(c.cost_usd, 0);
    assert.equal(
      pausedReason(),
      "Luma has suspended this API client. Contact Luma support.",
    );
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(4b) a rejected request fails the candidate once, without pausing", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return {
        status: 400,
        body: JSON.stringify({ detail: "prompt too long" }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "failed");
    assert.equal(
      c.failure_reason,
      "Luma rejected this request: prompt too long.",
    );
    assert.equal(c.cost_usd, 0);
    assert.equal(pausedReason(), null, "our bad request is not Luma's outage");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(4) 429 backs off without pausing or spending an attempt", async () => {
  reset();
  seedProduct();
  const id = seedCandidate();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init))
      return {
        status: 429,
        headers: { "Retry-After": "7" },
        body: JSON.stringify({ detail: "Too many requests" }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "queued");
    assert.equal(c.attempts, 0);
    assert.equal(c.cost_usd, 0);
    assert.equal(pausedReason(), null);
    const before = calls.length;
    await tick();
    assert.equal(calls.length, before, "still inside the 7 s back-off");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(5b) a 429 while polling backs off instead of spending an attempt on a paid image", async () => {
  reset();
  seedProduct();
  const id = seedCandidate({
    state: "processing",
    gid: "gen-5b",
    cost: env.costPerImage,
    attempts: 1,
  });
  const restore = stubFetch((url) => {
    if (url === "https://agents.lumalabs.ai/v1/generations/gen-5b")
      return {
        status: 429,
        headers: { "Retry-After": "7" },
        body: JSON.stringify({ detail: "Too many requests" }),
      };
    return miss(url);
  });
  try {
    await tick();
    const c = row(id);
    assert.equal(c.state, "processing");
    assert.equal(
      c.attempts,
      1,
      "the generation is paid for; polling costs no attempt",
    );
    assert.equal(c.cost_usd, env.costPerImage);
    assert.equal(pausedReason(), null);
    assert.deepEqual(unexpected, []);
    const before = lumaCalls().length;
    await tick();
    assert.equal(
      lumaCalls().length,
      before,
      "inside the Retry-After window the worker does not poll either",
    );
  } finally {
    restore();
  }
});

// Task 21: both loops run bounded-parallel inside one tick.

const poll = (gid: string) =>
  `https://agents.lumalabs.ai/v1/generations/${gid}`;
const delay = <T>(ms: number, v: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(v), ms));

/** A reply the test releases by hand, so parallelism is asserted, not timed. */
function deferred() {
  let resolve!: (r: Reply) => void;
  const promise = new Promise<Reply>((r) => (resolve = r));
  return { promise, resolve };
}

test("(P1) all four polls are issued before any reply arrives, and all complete in one tick", async () => {
  reset();
  const ids = [1, 2, 3, 4].map((n) => {
    seedProduct(`HG-00${n}`, 0);
    return seedCandidate({
      sku: `HG-00${n}`,
      state: "processing",
      gid: `gen-p1-${n}`,
      cost: env.costPerImage,
      attempts: 1,
    });
  });
  const pending: { gid: string; resolve: (r: Reply) => void }[] = [];
  let released = 0;
  const restore = stubFetch((url) => {
    if (url.startsWith(poll("gen-p1-"))) {
      const d = deferred();
      pending.push({ gid: url.slice(poll("").length), resolve: d.resolve });
      return d.promise;
    }
    if (url === OUTPUT) return { body: JPEG };
    if (url === SLACK) return { body: "ok" };
    return miss(url);
  });
  const release = () => {
    for (const p of pending.splice(0)) {
      released++;
      p.resolve({
        body: JSON.stringify({
          id: p.gid,
          state: "completed",
          output: [{ url: OUTPUT }],
        }),
      });
    }
  };
  let done = false;
  const running = tick().finally(() => (done = true));
  try {
    // Parallel: all four polls are in flight while none has answered. Serial: the loop
    // is stuck on the first unanswered poll, so pending never grows past one. The deadline
    // only bounds the failure path; the pass path leaves the loop as soon as four are seen.
    const deadline = Date.now() + 2_000;
    while (pending.length < 4 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 1));
    assert.equal(released, 0, "no poll was answered yet");
    assert.equal(pending.length, 4, "four polls issued before any is released");
    release();
    await running;
    for (const id of ids) assert.equal(row(id).state, "completed");
    assert.deepEqual(unexpected, []);
  } finally {
    // Never leave the tick hanging on an unanswered poll: a serial loop issues the next
    // one only after the previous is released, so keep releasing until the tick settles.
    while (!done) {
      release();
      await new Promise((r) => setTimeout(r, 1));
    }
    restore();
  }
});

test("(P2) two queued candidates of one SKU share one photo fetch and both submit", async () => {
  reset();
  seedProduct();
  const a = seedCandidate();
  const b = seedCandidate();
  let n = 0;
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return delay(10, { body: JPEG });
    if (isSubmit(url, init))
      return { body: JSON.stringify({ id: `gen-p2-${++n}`, state: "queued" }) };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(
      calls.filter((x) => x.url === PHOTO).length,
      1,
      "the photo host is hit once per SKU per tick",
    );
    for (const id of [a, b]) {
      const c = row(id);
      assert.equal(c.state, "processing");
      assert.equal(c.cost_usd, env.costPerImage);
      assert.ok(c.luma_generation_id);
    }
    assert.notEqual(row(a).luma_generation_id, row(b).luma_generation_id);
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(P3) a 402 on one of three parallel submits pauses once; siblings are charged only for accepted jobs", async () => {
  reset();
  const ids = [1, 2, 3].map((n) => {
    seedProduct(`HG-00${n}`, 0);
    return seedCandidate({ sku: `HG-00${n}` });
  });
  let n = 0;
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (isSubmit(url, init)) {
      const k = ++n;
      if (k === 2)
        return {
          status: 402,
          body: JSON.stringify({ detail: "insufficient balance" }),
        };
      return { body: JSON.stringify({ id: `gen-p3-${k}`, state: "queued" }) };
    }
    if (url.startsWith(poll("gen-p3-")))
      return {
        body: JSON.stringify({
          id: url.slice(poll("").length),
          state: "processing",
        }),
      };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(
      pausedReason(),
      "Luma has no credits left. Add funds, then press Resume.",
    );
    const states = ids.map((id) => row(id).state).sort();
    assert.ok(!states.includes("failed"), "a 402 never fails a candidate");
    assert.equal(
      states.filter((s) => s === "queued").length >= 1,
      true,
      "the 402'd candidate stays queued",
    );
    for (const id of ids) {
      const c = row(id);
      if (c.state === "processing") {
        // Race A: an accepted job is real money, so it is charged, with its id.
        assert.ok(c.luma_generation_id);
        assert.equal(c.cost_usd, env.costPerImage);
        assert.equal(c.attempts, 1);
      } else {
        assert.equal(c.state, "queued");
        assert.equal(c.cost_usd, 0);
        assert.equal(c.attempts, 0);
        assert.equal(c.luma_generation_id, null);
      }
    }
    const submits = () => calls.filter((x) => isSubmit(x.url, x.init)).length;
    const before = submits();
    await tick(); // paused: paid images are still polled, nothing new is submitted
    assert.equal(submits(), before, "a paused worker submits nothing");
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(P4) one expired download in a poll wave does not stop a sibling from completing", async () => {
  reset();
  seedProduct("HG-002", 0);
  const expired = seedCandidate({
    sku: "HG-002",
    state: "processing",
    gid: "gen-p4-a",
    cost: env.costPerImage,
    attempts: 1,
  });
  seedProduct("HG-003", 0);
  const fine = seedCandidate({
    sku: "HG-003",
    state: "processing",
    gid: "gen-p4-b",
    cost: env.costPerImage,
    attempts: 1,
  });
  const GONE = "https://storage.lumalabs.test/out/gone.jpg";
  const restore = stubFetch((url) => {
    if (url === poll("gen-p4-a"))
      return {
        body: JSON.stringify({
          id: "gen-p4-a",
          state: "completed",
          output: [{ url: GONE }],
        }),
      };
    if (url === poll("gen-p4-b"))
      return {
        body: JSON.stringify({
          id: "gen-p4-b",
          state: "completed",
          output: [{ url: OUTPUT }],
        }),
      };
    if (url === GONE) return { status: 403, body: "expired" };
    if (url === OUTPUT) return { body: JPEG };
    if (url === SLACK) return { body: "ok" };
    return miss(url);
  });
  try {
    await tick();
    const a = row(expired);
    assert.equal(a.state, "processing", "re-polled for a fresh URL next tick");
    assert.equal(a.attempts, 2);
    assert.equal(a.cost_usd, env.costPerImage);
    const b = row(fine);
    assert.equal(b.state, "completed");
    assert.equal(b.attempts, 1);
    assert.ok(storage.readImage(fine));
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

const PHOTO2 =
  "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-003.jpg";

/** Two queued candidates of different SKUs with distinct photo URLs, so a test can answer one late. */
function seedSlowPair() {
  seedProduct("HG-002", 0);
  seedProduct("HG-003", 0);
  d.prepare("update products set photo_url = ? where sku = ?").run(
    PHOTO2,
    "HG-003",
  );
  return [seedCandidate({ sku: "HG-002" }), seedCandidate({ sku: "HG-003" })];
}

test("(P5) a candidate still fetching its photo when a sibling's 402 pauses the worker is not submitted", async () => {
  reset();
  const [first, second] = seedSlowPair();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (url === PHOTO2) return delay(30, { body: JPEG });
    if (isSubmit(url, init))
      return {
        status: 402,
        body: JSON.stringify({ detail: "insufficient balance" }),
      };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(
      pausedReason(),
      "Luma has no credits left. Add funds, then press Resume.",
    );
    assert.equal(
      calls.filter((x) => isSubmit(x.url, x.init)).length,
      1,
      "the guard after the photo await stops the second submit (race A)",
    );
    for (const id of [first, second]) {
      const c = row(id);
      assert.equal(c.state, "queued");
      assert.equal(c.cost_usd, 0);
      assert.equal(c.attempts, 0);
      assert.equal(c.luma_generation_id, null);
    }
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(P6) a candidate still fetching its photo when a sibling's 429 sets the back-off is not submitted this tick", async () => {
  reset();
  const [first, second] = seedSlowPair();
  const restore = stubFetch((url, init) => {
    if (url === PHOTO) return { body: JPEG };
    if (url === PHOTO2) return delay(30, { body: JPEG });
    if (isSubmit(url, init))
      return {
        status: 429,
        headers: { "Retry-After": "7" },
        body: JSON.stringify({ detail: "Too many requests" }),
      };
    return miss(url);
  });
  try {
    await tick();
    assert.equal(pausedReason(), null);
    assert.equal(
      calls.filter((x) => isSubmit(x.url, x.init)).length,
      1,
      "the guard after the photo await honours the back-off (race C)",
    );
    for (const id of [first, second]) {
      const c = row(id);
      assert.equal(c.state, "queued");
      assert.equal(c.cost_usd, 0);
      assert.equal(c.attempts, 0);
    }
    assert.deepEqual(unexpected, []);
  } finally {
    restore();
  }
});

test("(P7) two 429s in one poll wave keep the longer Retry-After, not the last one to land", async () => {
  reset();
  seedProduct("HG-002", 0);
  seedCandidate({
    sku: "HG-002",
    state: "processing",
    gid: "gen-p7-long",
    cost: env.costPerImage,
    attempts: 1,
  });
  seedProduct("HG-003", 0);
  seedCandidate({
    sku: "HG-003",
    state: "processing",
    gid: "gen-p7-short",
    cost: env.costPerImage,
    attempts: 1,
  });
  const tooMany = (retryAfter: string): Reply => ({
    status: 429,
    headers: { "Retry-After": retryAfter },
    body: JSON.stringify({ detail: "Too many requests" }),
  });
  const restore = stubFetch((url) => {
    if (url === poll("gen-p7-long")) return tooMany("60");
    if (url === poll("gen-p7-short")) return delay(20, tooMany("7")); // lands second
    return miss(url);
  });
  try {
    await tick();
    const worker = globalThis.__shotsWorkerState;
    assert.ok(worker);
    assert.ok(
      worker.nextSubmitAt - Date.now() >= 55_000,
      "the 7 s Retry-After that landed later must not shorten the 60 s window",
    );
    seedProduct("HG-004", 0);
    const queued = seedCandidate({ sku: "HG-004" });
    const before = calls.length;
    await tick();
    assert.equal(calls.length, before, "inside the window nothing is called");
    assert.equal(row(queued).state, "queued");
    assert.equal(row(queued).cost_usd, 0);
    assert.deepEqual(unexpected, []);
  } finally {
    // The deadline is process-global; a 60 s window left behind would stall every later test.
    if (globalThis.__shotsWorkerState)
      globalThis.__shotsWorkerState.nextSubmitAt = 0;
    restore();
  }
});

test("(P7b) two 429s in one submit wave keep the longer Retry-After, not the last one to land", async () => {
  reset();
  const [first, second] = seedSlowPair();
  const tooMany = (retryAfter: string): Reply => ({
    status: 429,
    headers: { "Retry-After": retryAfter },
    body: JSON.stringify({ detail: "Too many requests" }),
  });
  // Both photos answer at once so both submits are in flight before either reply lands;
  // the first reply says 60 s, the second (delayed) says 7 s.
  let submits = 0;
  const restore = stubFetch((url, init) => {
    if (url === PHOTO || url === PHOTO2) return { body: JPEG };
    if (isSubmit(url, init))
      return submits++ === 0 ? tooMany("60") : delay(20, tooMany("7"));
    return miss(url);
  });
  try {
    await tick();
    assert.equal(
      submits,
      2,
      "both submits were in flight before the first 429",
    );
    const worker = globalThis.__shotsWorkerState;
    assert.ok(worker);
    assert.ok(
      worker.nextSubmitAt - Date.now() >= 55_000,
      "the 7 s Retry-After that landed later must not shorten the 60 s window",
    );
    for (const id of [first, second]) {
      assert.equal(row(id).state, "queued");
      assert.equal(row(id).cost_usd, 0);
      assert.equal(row(id).attempts, 0);
    }
    assert.deepEqual(unexpected, []);
  } finally {
    if (globalThis.__shotsWorkerState)
      globalThis.__shotsWorkerState.nextSubmitAt = 0;
    restore();
  }
});
