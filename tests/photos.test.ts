import { test } from "node:test";
import assert from "node:assert/strict";

const { fetchPhoto, photoUrlProblem, MAX_PHOTO_BYTES, PhotoError } =
  await import("../lib/photos.ts");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** The worker branches on `retryable`, so every throw has to carry the right one. */
const isPhotoError = (retryable: boolean) => (e: unknown) =>
  e instanceof PhotoError && e.retryable === retryable;

function stubFetch(status: number, bodyBytes: Uint8Array) {
  const original = globalThis.fetch;
  let capturedHeaders: Record<string, string> | undefined;
  globalThis.fetch = (async (
    _url: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return new Response(bodyBytes.buffer as ArrayBuffer, { status });
  }) as typeof fetch;
  return {
    headers: () => capturedHeaders,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

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

/** Answers a sequence of redirects/responses in order, then repeats the last one. */
function stubFetchSequence(
  responses: { status: number; location?: string; body?: Uint8Array }[],
) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (): Promise<Response> => {
    const r = responses[Math.min(calls, responses.length - 1)];
    calls++;
    const headers = r.location ? { Location: r.location } : undefined;
    return new Response((r.body ?? JPEG).buffer as ArrayBuffer, {
      status: r.status,
      headers,
    });
  }) as typeof fetch;
  return {
    callCount: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("fetchPhoto rejects a private-network URL before ever calling fetch", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JPEG.buffer as ArrayBuffer, { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchPhoto("http://169.254.169.254/latest/meta-data"),
      isPhotoError(false),
    );
    assert.equal(called, false, "no network call for a rejected URL");
  } finally {
    globalThis.fetch = original;
  }
});

test("sends a browser User-Agent", async () => {
  const stub = stubFetch(200, JPEG);
  try {
    await fetchPhoto("https://host.example/photo.jpg");
    assert.match(stub.headers()?.["User-Agent"] ?? "", /Chrome/);
  } finally {
    stub.restore();
  }
});

test("returns a Buffer of the body bytes on 200", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const stub = stubFetch(200, bytes);
  try {
    const buf = await fetchPhoto("https://host.example/photo.jpg");
    assert.ok(Buffer.isBuffer(buf));
    assert.deepEqual(buf, Buffer.from(bytes));
  } finally {
    stub.restore();
  }
});

test("a redirect to a private-network URL throws the guard's reason before a second fetch", async () => {
  const stub = stubFetchSequence([
    { status: 302, location: "http://127.0.0.1/x.jpg" },
  ]);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /private or loopback/,
    );
    assert.equal(stub.callCount(), 1, "no second fetch after a bad redirect");
  } finally {
    stub.restore();
  }
});

test("a redirect to an allowed host is followed and returns the bytes", async () => {
  const stub = stubFetchSequence([
    { status: 302, location: "https://cdn.example/photo.jpg" },
    { status: 200 },
  ]);
  try {
    const buf = await fetchPhoto("https://host.example/photo.jpg");
    assert.deepEqual(buf, Buffer.from(JPEG));
    assert.equal(stub.callCount(), 2);
  } finally {
    stub.restore();
  }
});

test("four chained redirects throw 'redirects too many times'", async () => {
  const stub = stubFetchSequence([
    { status: 302, location: "https://host.example/1.jpg" },
    { status: 302, location: "https://host.example/2.jpg" },
    { status: 302, location: "https://host.example/3.jpg" },
    { status: 302, location: "https://host.example/4.jpg" },
  ]);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /redirects too many times/,
    );
    assert.equal(stub.callCount(), 4, "3 hops followed, the 4th one throws");
  } finally {
    stub.restore();
  }
});

test("a redirect with no Location header is not reachable and not retryable", async () => {
  const stub = stubFetchSequence([{ status: 302 }]);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(false),
    );
  } finally {
    stub.restore();
  }
});

test("403 throws 'photo not reachable (HTTP 403)' and never retries", async () => {
  const stub = stubFetch(403, new Uint8Array());
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo not reachable \(HTTP 403\)/,
    );
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(false),
    );
  } finally {
    stub.restore();
  }
});

test("503 is retryable: the host may answer on the next tick", async () => {
  const stub = stubFetch(503, new Uint8Array());
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo not reachable \(HTTP 503\)/,
    );
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(true),
    );
  } finally {
    stub.restore();
  }
});

test("a timeout or dead socket is retryable", async () => {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  const stub = stubFetchThrows(err);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(true),
    );
  } finally {
    stub.restore();
  }
});

test("a 200 that is not a JPEG (HTML error page) throws, so no paid attempt is spent", async () => {
  const stub = stubFetch(
    200,
    new TextEncoder().encode("<html>Access denied</html>"),
  );
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo is not a JPEG/,
    );
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(false),
    );
  } finally {
    stub.restore();
  }
});

test("an empty 200 body throws", async () => {
  const stub = stubFetch(200, new Uint8Array());
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo is not a JPEG/,
    );
  } finally {
    stub.restore();
  }
});

test("photoUrlProblem rejects unsafe URLs and accepts safe ones", () => {
  const rejected: [string, RegExp][] = [
    ["not-a-url", /valid URL/],
    ["ftp://host.example/a.jpg", /protocol/],
    ["http://user:pass@host.example/a.jpg", /credentials/],
    ["http://localhost/a.jpg", /localhost/],
    ["http://sub.localhost/a.jpg", /localhost/],
    ["http://localhost./a.jpg", /localhost/],
    ["http://sub.localhost./a.jpg", /localhost/],
    ["http://127.0.0.1/a.jpg", /private or loopback/],
    ["http://10.1.2.3/a.jpg", /private or loopback/],
    ["http://169.254.1.1/a.jpg", /private or loopback/],
    ["http://172.16.0.5/a.jpg", /private or loopback/],
    ["http://172.31.255.255/a.jpg", /private or loopback/],
    ["http://192.168.1.1/a.jpg", /private or loopback/],
    ["http://100.64.0.1/a.jpg", /private or loopback/],
    ["http://[64:ff9b::a00:1]/a.jpg", /private or loopback/],
    ["http://0.0.0.0/a.jpg", /private or loopback/],
    ["http://[::1]/a.jpg", /private or loopback/],
    ["http://[::]/a.jpg", /private or loopback/],
    ["http://[fc00::1]/a.jpg", /private or loopback/],
    ["http://[fd12:3456::1]/a.jpg", /private or loopback/],
    ["http://[fe80::1]/a.jpg", /private or loopback/],
    ["http://[::ffff:127.0.0.1]/a.jpg", /private or loopback/],
    ["http://[::ffff:7f00:1]/a.jpg", /private or loopback/],
    // Embedded IPv4-in-IPv6 translation prefixes (Codex finding 3)
    ["http://[64:ff9b:1::7f00:1]/a.jpg", /private or loopback/], // NAT64 /48, embeds 127.0.0.1
    ["http://[::ffff:0:7f00:1]/a.jpg", /private or loopback/], // SIIT, embeds 127.0.0.1
    ["http://[::ffff:127.0.0.1]/a.jpg", /private or loopback/], // mapped, dotted form
  ];
  for (const [url, reason] of rejected)
    assert.match(photoUrlProblem(url) ?? "", reason, url);

  const accepted = [
    "https://take-home-service.lumalabs-ext.workers.dev/assets/a.jpg",
    "http://172.15.255.255/a.jpg", // just below 172.16/12
    "http://172.32.0.0/a.jpg", // just above 172.16/12
    "http://8.8.8.8/a.jpg",
    "http://[2001:db8::1]/a.jpg", // public IPv6
    "http://[64:ff9b::808:808]/a.jpg", // NAT64 embedding public 8.8.8.8
  ];
  for (const url of accepted) assert.equal(photoUrlProblem(url), null, url);
});

test("a JPEG over the size cap throws and never retries", async () => {
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set(JPEG);
  const stub = stubFetch(200, big);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo too large/,
    );
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      isPhotoError(false),
    );
  } finally {
    stub.restore();
  }
});
