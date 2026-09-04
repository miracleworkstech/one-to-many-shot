// Task 8: one shared token gates every route (delta A) so a CSV link like
// `${APP_URL}/img/<id>?k=<token>` (lib/export.ts:38) works for whoever clicks it, not just `/`.
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const token = process.env.ACCESS_TOKEN;
  if (!token) return NextResponse.next(); // local dev without a token
  const k = req.nextUrl.searchParams.get("k");
  if (k === token) {
    // Railway terminates TLS, so req.nextUrl is the container's internal http origin, and
    // x-forwarded-* headers are client-controlled (open-redirect risk) — redirect against the
    // configured APP_URL instead; the team link (lib/export.ts:38) is built from it, so the
    // host matches by construction.
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const clean = req.nextUrl.clone();
    clean.searchParams.delete("k");
    const url = new URL(clean.pathname + clean.search, appUrl);
    const res = NextResponse.redirect(url);
    res.cookies.set("k", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  }
  if (req.cookies.get("k")?.value === token) return NextResponse.next();
  return new NextResponse(
    "This page needs the team link. Ask Maya or Ellie for it.",
    { status: 401 },
  );
}

export const config = {
  matcher: ["/((?!_next/|favicon\\.ico$|healthz$).*)"],
};
