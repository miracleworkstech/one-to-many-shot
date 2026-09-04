import { test } from "node:test";
import assert from "node:assert/strict";

// A fake key so the redaction path is exercised; nothing here reaches the network.
process.env.LUMA_AGENTS_API_KEY = "test-key-abc123";
const {
  submitEdit,
  getGeneration,
  LumaError,
  LumaBudgetError,
  LumaRateLimitError,
} = await import("../lib/luma.ts");

type Captured = { url: string; init?: RequestInit };

// Stub fetch for one test; never reaches the network, never needs a key.
function stubFetch(
  status: number,
  body: string,
  headers?: Record<string, string>,
) {
  const original = globalThis.fetch;
  let captured: Captured | undefined;
  globalThis.fetch = (async (
    url: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    captured = { url: String(url), init };
    return new Response(body, { status, headers });
  }) as typeof fetch;
  return {
    captured: () => captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// Stub fetch to throw instead of resolving, e.g. a real network/timeout failure.
function stubFetchThrows(err: Error) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw err;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function expectLumaError(
  run: () => Promise<unknown>,
  expect: {
    ctor?: typeof LumaError;
    code: string;
    userMessage: string;
    retryable: boolean;
    retryAfterMs?: number;
    status?: number;
  },
) {
  try {
    await run();
    assert.fail("expected a rejection");
  } catch (err) {
    assert.ok(err instanceof (expect.ctor ?? LumaError));
    const e = err as InstanceType<typeof LumaError>;
    assert.equal(e.code, expect.code);
    assert.equal(e.userMessage, expect.userMessage);
    assert.equal(e.message, expect.userMessage, "message mirrors userMessage");
    assert.equal(e.retryable, expect.retryable);
    if (expect.status !== undefined) assert.equal(e.status, expect.status);
    if (expect.retryAfterMs !== undefined)
      assert.equal(e.retryAfterMs, expect.retryAfterMs);
  }
}

test("402 throws LumaBudgetError", async () => {
  const stub = stubFetch(
    402,
    JSON.stringify({ detail: "insufficient balance" }),
  );
  try {
    await expectLumaError(() => getGeneration("g1"), {
      ctor: LumaBudgetError,
      code: "budget",
      userMessage: "Luma has no credits left. Add funds, then press Resume.",
      retryable: false,
      status: 402,
    });
  } finally {
    stub.restore();
  }
});

test("401 throws LumaError code auth", async () => {
  const stub = stubFetch(401, JSON.stringify({ detail: "invalid key" }));
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "auth",
      userMessage:
        "Luma rejected the API key. Fix LUMA_AGENTS_API_KEY, then press Resume.",
      retryable: false,
      status: 401,
    });
  } finally {
    stub.restore();
  }
});

test("403 throws LumaError code forbidden", async () => {
  const stub = stubFetch(403, JSON.stringify({ detail: "suspended" }));
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "forbidden",
      userMessage: "Luma has suspended this API client. Contact Luma support.",
      retryable: false,
    });
  } finally {
    stub.restore();
  }
});

test("429 'Rate limit exceeded' uses Retry-After header and the generic message", async () => {
  const stub = stubFetch(
    429,
    JSON.stringify({ detail: "Rate limit exceeded" }),
    { "Retry-After": "7" },
  );
  try {
    await expectLumaError(() => getGeneration("g1"), {
      ctor: LumaRateLimitError,
      code: "rate_limited",
      userMessage: "Luma is rate limiting us. Waiting 7 s.",
      retryable: true,
      retryAfterMs: 7000,
    });
  } finally {
    stub.restore();
  }
});

test("429 'Too many concurrent jobs' uses the busy message, defaults to 60s without a header", async () => {
  const stub = stubFetch(
    429,
    JSON.stringify({ detail: "Too many concurrent jobs" }),
  );
  try {
    await expectLumaError(() => getGeneration("g1"), {
      ctor: LumaRateLimitError,
      code: "rate_limited",
      userMessage: "Luma is busy with our other jobs. Waiting 60 s.",
      retryable: true,
      retryAfterMs: 60_000,
    });
  } finally {
    stub.restore();
  }
});

test("429 with a non-numeric Retry-After falls back to 60s", async () => {
  const stub = stubFetch(
    429,
    JSON.stringify({ detail: "Rate limit exceeded" }),
    {
      "Retry-After": "soon",
    },
  );
  try {
    await expectLumaError(() => getGeneration("g1"), {
      ctor: LumaRateLimitError,
      code: "rate_limited",
      userMessage: "Luma is rate limiting us. Waiting 60 s.",
      retryable: true,
      retryAfterMs: 60_000,
    });
  } finally {
    stub.restore();
  }
});

for (const status of [400, 413, 422]) {
  test(`${status} throws LumaError code bad_request with Luma's detail`, async () => {
    const stub = stubFetch(status, JSON.stringify({ detail: "bad params" }));
    try {
      await expectLumaError(() => getGeneration("g1"), {
        code: "bad_request",
        userMessage: "Luma rejected this request: bad params.",
        retryable: false,
      });
    } finally {
      stub.restore();
    }
  });
}

test("404 throws LumaError code not_found", async () => {
  const stub = stubFetch(404, JSON.stringify({ detail: "no such generation" }));
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "not_found",
      userMessage: "Luma no longer knows this generation.",
      retryable: false,
    });
  } finally {
    stub.restore();
  }
});

for (const status of [502, 503, 500]) {
  test(`${status} throws LumaError code upstream, retryable`, async () => {
    const stub = stubFetch(status, "upstream exploded");
    try {
      await expectLumaError(() => getGeneration("g1"), {
        code: "upstream",
        userMessage: "Luma is temporarily unavailable. Retrying.",
        retryable: true,
        status, // carried for logs even though the message doesn't repeat it
      });
    } finally {
      stub.restore();
    }
  });
}

test("5xx with a well-formed {id,state} body still rejects (status guard, not just JSON parse)", async () => {
  const stub = stubFetch(503, JSON.stringify({ id: "g1", state: "queued" }));
  try {
    await expectLumaError(
      () => submitEdit({ prompt: "x", jpegBase64: "QUJD" }),
      {
        code: "upstream",
        userMessage: "Luma is temporarily unavailable. Retrying.",
        retryable: true,
      },
    );
  } finally {
    stub.restore();
  }
});

test("TimeoutError/AbortError from fetch maps to code timeout", async () => {
  const err = new Error("aborted");
  err.name = "TimeoutError";
  const stub = stubFetchThrows(err);
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "timeout",
      userMessage: "Luma did not answer within 30 s. Retrying.",
      retryable: true,
    });
  } finally {
    stub.restore();
  }
});

test("other fetch exceptions map to code network, with the original message in detail", async () => {
  const stub = stubFetchThrows(new Error("ECONNRESET"));
  try {
    const err = await getGeneration("g1").catch((e: unknown) => e);
    assert.ok(err instanceof LumaError);
    assert.equal(err.code, "network");
    assert.equal(err.userMessage, "Could not reach Luma. Retrying.");
    assert.equal(err.retryable, true);
    assert.equal(err.detail, "ECONNRESET");
  } finally {
    stub.restore();
  }
});

test("non-JSON body throws invalid_response with status and first 200 chars in detail", async () => {
  const stub = stubFetch(200, "<html>not json</html>");
  try {
    const err = await getGeneration("g1").catch((e: unknown) => e);
    assert.ok(err instanceof LumaError);
    assert.equal(err.code, "invalid_response");
    assert.equal(err.userMessage, "Luma sent an unexpected reply. Retrying.");
    assert.equal(err.retryable, true);
    assert.match(err.detail, /not json/);
  } finally {
    stub.restore();
  }
});

test("body missing id/state throws invalid_response", async () => {
  const stub = stubFetch(200, JSON.stringify({ ok: true }));
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "invalid_response",
      userMessage: "Luma sent an unexpected reply. Retrying.",
      retryable: true,
    });
  } finally {
    stub.restore();
  }
});

test("unknown state throws invalid_response with the raw state in detail", async () => {
  const stub = stubFetch(200, JSON.stringify({ id: "g1", state: "sideways" }));
  try {
    await getGeneration("g1");
    assert.fail("expected a rejection");
  } catch (e) {
    const err = e as InstanceType<typeof LumaError>;
    assert.equal(err.code, "invalid_response");
    assert.equal(err.detail, "sideways");
  } finally {
    stub.restore();
  }
});

test("completed without a usable output url throws invalid_response instead of stalling the worker", async () => {
  for (const output of [undefined, [], [{ url: 123 }], [{ url: "" }]]) {
    const stub = stubFetch(
      200,
      JSON.stringify({ id: "g1", state: "completed", output }),
    );
    try {
      const err = await getGeneration("g1").catch((e: unknown) => e);
      assert.ok(err instanceof LumaError);
      assert.equal(err.code, "invalid_response");
      assert.match(err.detail, /completed without an output url/);
    } finally {
      stub.restore();
    }
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

const FAILURE_CASES: {
  failure_code: string;
  failure_reason: string;
  userMessage: string;
  retryable: boolean;
}[] = [
  {
    failure_code: "content_moderated",
    failure_reason: "blocked content",
    userMessage:
      "Luma's moderation blocked this prompt or photo. Edit the idea and try again.",
    retryable: false,
  },
  {
    failure_code: "image_too_large",
    failure_reason: "source exceeds 50 MB",
    userMessage: "Luma could not use the product photo: source exceeds 50 MB.",
    retryable: false,
  },
  {
    failure_code: "unsupported_format",
    failure_reason: "webp not supported",
    userMessage: "Luma could not use the product photo: webp not supported.",
    retryable: false,
  },
  {
    failure_code: "corrupt_input",
    failure_reason: "could not decode",
    userMessage: "Luma could not use the product photo: could not decode.",
    retryable: false,
  },
  {
    failure_code: "invalid_request",
    failure_reason: "bad params",
    userMessage: "Luma could not use the product photo: bad params.",
    retryable: false,
  },
  {
    failure_code: "budget_exhausted",
    failure_reason: "out of credits",
    userMessage:
      "Luma ran out of credits during this generation. Add funds, then press Resume.",
    retryable: false,
  },
  {
    failure_code: "generation_failed",
    failure_reason: "internal error",
    userMessage: "Luma failed on its side. Try again.",
    retryable: true,
  },
  {
    failure_code: "output_not_found",
    failure_reason: "output missing",
    userMessage: "Luma failed on its side. Try again.",
    retryable: true,
  },
  {
    failure_code: "rate_limited",
    failure_reason: "internal throttle",
    userMessage: "Luma failed on its side. Try again.",
    retryable: true,
  },
];

for (const c of FAILURE_CASES) {
  test(`failed generation with failure_code ${c.failure_code} maps to the right message`, async () => {
    const stub = stubFetch(
      200,
      JSON.stringify({
        id: "g1",
        state: "failed",
        failure_code: c.failure_code,
        failure_reason: c.failure_reason,
      }),
    );
    try {
      const result = await getGeneration("g1");
      assert.equal(result.state, "failed");
      assert.ok(result.failure);
      assert.equal(result.failure?.code, c.failure_code);
      assert.equal(result.failure?.userMessage, c.userMessage);
      assert.equal(result.failure?.retryable, c.retryable);
      assert.equal(
        result.failure?.detail,
        `${c.failure_code} ${c.failure_reason}`,
      );
    } finally {
      stub.restore();
    }
  });
}

test("failed generation with an undocumented failure_code maps to unknown", async () => {
  const stub = stubFetch(
    200,
    JSON.stringify({
      id: "g1",
      state: "failed",
      failure_code: "something_new",
      failure_reason: "who knows",
    }),
  );
  try {
    const result = await getGeneration("g1");
    assert.equal(result.failure?.code, "unknown");
    assert.equal(
      result.failure?.userMessage,
      "Luma failed on its side. Try again.",
    );
    assert.equal(result.failure?.retryable, true);
    assert.equal(result.failure?.detail, "something_new who knows");
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
    await expectLumaError(
      () => submitEdit({ prompt: "p", jpegBase64: "QUJD" }),
      {
        code: "invalid_response",
        userMessage: "Luma sent an unexpected reply. Retrying.",
        retryable: true,
      },
    );
  } finally {
    stub.restore();
  }
});

test("AbortError from fetch also maps to code timeout", async () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  const stub = stubFetchThrows(err);
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "timeout",
      userMessage: "Luma did not answer within 30 s. Retrying.",
      retryable: true,
    });
  } finally {
    stub.restore();
  }
});

test("a body that fails to read maps to code network, not a raw exception", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> => {
    const res = new Response("x", { status: 200 });
    res.text = () => Promise.reject(new Error("stream terminated"));
    return res;
  }) as typeof fetch;
  try {
    await expectLumaError(() => getGeneration("g1"), {
      code: "network",
      userMessage: "Could not reach Luma. Retrying.",
      retryable: true,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Retry-After of 0, negative or fractional never yields an instant retry", async () => {
  for (const [header, expected] of [
    ["0", 60_000],
    ["-5", 60_000],
    ["0.2", 1000],
    ["Wed, 21 Oct 2026 07:28:00 GMT", 60_000],
  ] as const) {
    const stub = stubFetch(
      429,
      JSON.stringify({ detail: "Rate limit exceeded" }),
      {
        "Retry-After": header,
      },
    );
    try {
      await expectLumaError(() => getGeneration("g1"), {
        ctor: LumaRateLimitError,
        code: "rate_limited",
        userMessage: `Luma is rate limiting us. Waiting ${expected / 1000} s.`,
        retryable: true,
        retryAfterMs: expected,
      });
    } finally {
      stub.restore();
    }
  }
});

test("the API key never appears in userMessage or detail even if a body echoes it", async () => {
  const stub = stubFetch(
    400,
    JSON.stringify({ detail: "bad token test-key-abc123 rejected" }),
  );
  try {
    await getGeneration("g1");
    assert.fail("expected a rejection");
  } catch (err) {
    assert.ok(err instanceof LumaError);
    assert.doesNotMatch(err.userMessage, /test-key-abc123/);
    assert.doesNotMatch(err.detail, /test-key-abc123/);
    assert.match(err.detail, /\[redacted\]/);
  } finally {
    stub.restore();
  }
});
