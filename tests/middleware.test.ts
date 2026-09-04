import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware, config } from "../middleware.ts";
import { GET as healthzGet } from "../app/healthz/route.ts";

const withToken = <T>(fn: () => T): T => {
  const saved = process.env.ACCESS_TOKEN;
  process.env.ACCESS_TOKEN = "secret-token";
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.ACCESS_TOKEN;
    else process.env.ACCESS_TOKEN = saved;
  }
};

// middleware.ts reads process.env.APP_URL at call time (not via lib/env.ts, which is
// evaluated once at import time), so this can set/restore it per test the same way as
// ACCESS_TOKEN — no dynamic re-import of the module needed.
const withAppUrl = (url: string | undefined, fn: () => void) => {
  const saved = process.env.APP_URL;
  if (url === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = url;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
};

const req = (
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) => new NextRequest(url, init);

test("no ACCESS_TOKEN set: passes through", () => {
  const saved = process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKEN;
  try {
    const res = middleware(req("http://localhost:3000/"));
    assert.equal(res.status, 200); // NextResponse.next() default
    assert.equal(res.headers.get("x-middleware-next"), "1");
  } finally {
    if (saved !== undefined) process.env.ACCESS_TOKEN = saved;
  }
});

test("no cookie and no ?k=: 401 with the team-link message", async () => {
  const res = withToken(() => middleware(req("http://localhost:3000/")));
  assert.equal(res.status, 401);
  assert.equal(
    await res.text(),
    "This page needs the team link. Ask Maya or Ellie for it.",
  );
});

test("no ACCESS_TOKEN set, stale k cookie: passes through (guards the local-dev bypass)", () => {
  const saved = process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKEN;
  try {
    const res = middleware(
      req("http://localhost:3000/", { headers: { cookie: "k=leftover" } }),
    );
    assert.equal(res.headers.get("x-middleware-next"), "1");
  } finally {
    if (saved !== undefined) process.env.ACCESS_TOKEN = saved;
  }
});

test("wrong ?k=: 401, no Set-Cookie", () => {
  withToken(() => {
    const res = middleware(req("http://localhost:3000/?k=wrong"));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});

test("correct ?k= on /: redirect to / with a k cookie, k gone from the URL, no Secure on http", () => {
  withToken(() => {
    const res = middleware(req("http://localhost:3000/?k=secret-token"));
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.pathname, "/");
    assert.equal(location.searchParams.get("k"), null);
    const setCookie = res.headers.get("set-cookie")!;
    assert.match(setCookie, /^k=secret-token/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /Secure/i);
  });
});

test("correct ?k= on /img/12?k=T&x=1: redirect to /img/12?x=1", () => {
  withToken(() => {
    const res = middleware(
      req("http://localhost:3000/img/12?k=secret-token&x=1"),
    );
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.pathname, "/img/12");
    assert.equal(location.searchParams.get("k"), null);
    assert.equal(location.searchParams.get("x"), "1");
  });
});

test("correct cookie on /export/zip: passes through", () => {
  withToken(() => {
    const res = middleware(
      req("http://localhost:3000/export/zip", {
        headers: { cookie: "k=secret-token" },
      }),
    );
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });
});

test("wrong cookie: 401", () => {
  withToken(() => {
    const res = middleware(
      req("http://localhost:3000/export/zip", {
        headers: { cookie: "k=nope" },
      }),
    );
    assert.equal(res.status, 401);
  });
});

test("APP_URL set: redirect uses APP_URL as the origin, not localhost, and the cookie is Secure", () => {
  withToken(() => {
    withAppUrl("https://shots.example.railway.app", () => {
      const res = middleware(
        req("http://localhost:3000/img/12?k=secret-token&x=1"),
      );
      assert.equal(res.status, 307);
      const location = res.headers.get("location")!;
      assert.equal(location, "https://shots.example.railway.app/img/12?x=1");
      const setCookie = res.headers.get("set-cookie")!;
      assert.match(setCookie, /Secure/i);
    });
  });
});

test("APP_URL with trailing slash: no double slash in the redirect Location", () => {
  withToken(() => {
    withAppUrl("https://shots.example.railway.app/", () => {
      const res = middleware(
        req("http://localhost:3000/img/12?k=secret-token&x=1"),
      );
      assert.equal(res.status, 307);
      assert.equal(
        res.headers.get("location"),
        "https://shots.example.railway.app/img/12?x=1",
      );
    });
  });
});

test("open redirect: x-forwarded-host from the client does not change the Location", () => {
  withToken(() => {
    withAppUrl("https://shots.example.railway.app", () => {
      const res = middleware(
        req("http://localhost:3000/img/12?k=secret-token&x=1", {
          headers: { "x-forwarded-host": "evil.example.com" },
        }),
      );
      assert.equal(res.status, 307);
      assert.equal(
        res.headers.get("location"),
        "https://shots.example.railway.app/img/12?x=1",
      );
    });
  });
});

test("matcher excludes _next, favicon.ico and healthz; includes gated app paths", () => {
  // config.matcher's string is a regex *source*, unanchored: `.test()` on it directly would
  // false-positive on "/_next/static/x.js" (it also matches starting from the later "/static"
  // segment). Anchor at the leading "/" - which every pathname has - to test the same
  // semantics Next's own (anchored) compiled matcher uses.
  const pattern = new RegExp(`^${config.matcher[0]}`);
  for (const excluded of ["/_next/static/x.js", "/favicon.ico", "/healthz"]) {
    assert.equal(
      pattern.test(excluded),
      false,
      `${excluded} should be excluded`,
    );
  }
  for (const included of [
    "/",
    "/img/1",
    "/export/csv",
    "/review/HG-002",
    "/healthzfoo",
    "/_nextfoo",
  ]) {
    assert.equal(
      pattern.test(included),
      true,
      `${included} should be included`,
    );
  }
});

test("app/healthz/route.ts: 200 ok", async () => {
  const res = healthzGet();
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});
