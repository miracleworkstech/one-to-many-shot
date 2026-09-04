import { test } from "node:test";
import assert from "node:assert/strict";

const { fetchPhoto, MAX_PHOTO_BYTES } = await import("../lib/photos.ts");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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

test("403 throws 'photo not reachable (HTTP 403)'", async () => {
  const stub = stubFetch(403, new Uint8Array());
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo not reachable \(HTTP 403\)/,
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

test("a JPEG over the size cap throws", async () => {
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set(JPEG);
  const stub = stubFetch(200, big);
  try {
    await assert.rejects(
      () => fetchPhoto("https://host.example/photo.jpg"),
      /photo too large/,
    );
  } finally {
    stub.restore();
  }
});
