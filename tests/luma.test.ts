import { test } from "node:test";
import assert from "node:assert/strict";

const { submitEdit, getGeneration, LumaBudgetError, LumaRateLimitError } =
  await import("../lib/luma.ts");

type Captured = { url: string; init?: RequestInit };

// Stub fetch for one test; never reaches the network, never needs a key.
function stubFetch(status: number, body: string) {
  const original = globalThis.fetch;
  let captured: Captured | undefined;
  globalThis.fetch = (async (
    url: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    captured = { url: String(url), init };
    return new Response(body, { status });
  }) as typeof fetch;
  return {
    captured: () => captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("402 throws LumaBudgetError", async () => {
  const stub = stubFetch(402, "");
  try {
    await assert.rejects(() => getGeneration("g1"), LumaBudgetError);
  } finally {
    stub.restore();
  }
});

test("429 throws LumaRateLimitError", async () => {
  const stub = stubFetch(429, "");
  try {
    await assert.rejects(() => getGeneration("g1"), LumaRateLimitError);
  } finally {
    stub.restore();
  }
});

test("5xx throws a generic Error carrying the status", async () => {
  const stub = stubFetch(503, "upstream exploded");
  try {
    await assert.rejects(() => getGeneration("g1"), /503/);
  } finally {
    stub.restore();
  }
});

test("5xx with a well-formed {id,state} body still rejects (status guard, not just JSON parse)", async () => {
  const stub = stubFetch(503, JSON.stringify({ id: "g1", state: "queued" }));
  try {
    await assert.rejects(
      () => submitEdit({ prompt: "x", jpegBase64: "QUJD" }),
      /503/,
    );
  } finally {
    stub.restore();
  }
});

test("non-JSON body throws with status and first 200 chars", async () => {
  const stub = stubFetch(200, "<html>not json</html>");
  try {
    await assert.rejects(() => getGeneration("g1"), /200.*not json/);
  } finally {
    stub.restore();
  }
});

test("body missing id/state throws", async () => {
  const stub = stubFetch(200, JSON.stringify({ ok: true }));
  try {
    await assert.rejects(() => getGeneration("g1"), /200/);
  } finally {
    stub.restore();
  }
});

test("completed generation returns state and output[0].url", async () => {
  const stub = stubFetch(
    200,
    JSON.stringify({
      id: "g1",
      state: "completed",
      output: [{ url: "https://example.com/x.jpg" }],
    }),
  );
  try {
    const result = await getGeneration("g1");
    assert.equal(result.state, "completed");
    assert.equal(result.url, "https://example.com/x.jpg");
    assert.equal(result.failure, undefined);
  } finally {
    stub.restore();
  }
});

test("failed generation combines failure_code and failure_reason", async () => {
  const stub = stubFetch(
    200,
    JSON.stringify({
      id: "g1",
      state: "failed",
      failure_code: "moderation",
      failure_reason: "blocked content",
    }),
  );
  try {
    const result = await getGeneration("g1");
    assert.equal(result.state, "failed");
    assert.equal(result.failure, "moderation blocked content");
  } finally {
    stub.restore();
  }
});

test("unknown state throws", async () => {
  const stub = stubFetch(200, JSON.stringify({ id: "g1", state: "sideways" }));
  try {
    await assert.rejects(() => getGeneration("g1"), /sideways/);
  } finally {
    stub.restore();
  }
});

test("submitEdit posts the image_edit request with Bearer auth", async () => {
  const stub = stubFetch(
    200,
    JSON.stringify({ id: "gen-123", state: "queued" }),
  );
  try {
    const id = await submitEdit({
      prompt: "a cozy kitchen",
      jpegBase64: "QUJD",
    });
    assert.equal(id, "gen-123");

    const req = stub.captured();
    assert.ok(req);
    assert.equal(req?.url, "https://agents.lumalabs.ai/v1/generations");
    const init = req?.init as RequestInit;
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.match(headers.Authorization, /^Bearer /);
    assert.ok(
      init.signal instanceof AbortSignal,
      "request carries an abort signal",
    );
    const body = JSON.parse(init.body as string);
    assert.equal(body.type, "image_edit");
    assert.equal(body.model, "uni-1");
    assert.equal(body.output_format, "jpeg");
    assert.equal(body.prompt, "a cozy kitchen");
    assert.equal(body.source.data, "QUJD");
    assert.equal(body.source.media_type, "image/jpeg");
  } finally {
    stub.restore();
  }
});

test("submit with an empty generation id is rejected, not charged silently", async () => {
  const stub = stubFetch(200, JSON.stringify({ id: "", state: "queued" }));
  try {
    await assert.rejects(
      () => submitEdit({ prompt: "p", jpegBase64: "QUJD" }),
      /Luma 200/,
    );
  } finally {
    stub.restore();
  }
});

test("completed without a usable output url throws instead of stalling the worker", async () => {
  for (const output of [undefined, [], [{ url: 123 }], [{ url: "" }]]) {
    const stub = stubFetch(
      200,
      JSON.stringify({ id: "g1", state: "completed", output }),
    );
    try {
      await assert.rejects(
        () => getGeneration("g1"),
        /completed without an output url/,
      );
    } finally {
      stub.restore();
    }
  }
});

test("processing with no output yet returns url undefined", async () => {
  const stub = stubFetch(
    200,
    JSON.stringify({ id: "g1", state: "processing" }),
  );
  try {
    const g = await getGeneration("g1");
    assert.equal(g.state, "processing");
    assert.equal(g.url, undefined);
  } finally {
    stub.restore();
  }
});
