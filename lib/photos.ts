const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
export const MAX_PHOTO_BYTES = 15_000_000;

/** `retryable` decides whether the worker spends an attempt or fails the candidate now. */
export class PhotoError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PhotoError";
    this.retryable = retryable;
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // 100.64/10, carrier-grade NAT
  );
}

// Rewrites a trailing dotted IPv4 tail (e.g. "::ffff:127.0.0.1") into two hex groups
// ("::ffff:7f00:1") so expandIPv6 only ever has to deal with hex groups.
function normalizeIPv6(host: string): string {
  const m = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!m) return host;
  const parts = m[1].split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => n < 0 || n > 255)) return host;
  const hi = ((parts[0] << 8) | parts[1]).toString(16);
  const lo = ((parts[2] << 8) | parts[3]).toString(16);
  return host.slice(0, host.length - m[1].length) + `${hi}:${lo}`;
}

// Expands a bracket-stripped IPv6 address (one "::" run allowed) to its 8 numeric groups,
// or null if it doesn't parse.
function expandIPv6(host: string): number[] | null {
  const norm = normalizeIPv6(host);
  let groups: string[];
  if (norm.includes("::")) {
    const sides = norm.split("::");
    if (sides.length !== 2) return null;
    const left = sides[0] ? sides[0].split(":") : [];
    const right = sides[1] ? sides[1].split(":") : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill("0"), ...right];
  } else {
    groups = norm.split(":");
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
    return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPrivateIPv6(host: string): boolean {
  if (host === "::1" || host === "::") return true;
  const first = host.split(":")[0];
  if (/^[0-9a-f]{1,4}$/.test(first)) {
    const g = parseInt(first, 16);
    if ((g & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((g & 0xffc0) === 0xfe80) return true; // fe80::/10
  }
  const groups = expandIPv6(host);
  if (!groups) return false;
  const embedded = () =>
    `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  // ::ffff:0:0/96 (IPv4-mapped)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return isPrivateIPv4(embedded());
  // ::ffff:0:0:0/96 (SIIT)
  if (
    groups.slice(0, 4).every((g) => g === 0) &&
    groups[4] === 0xffff &&
    groups[5] === 0
  )
    return isPrivateIPv4(embedded());
  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (
    groups[0] === 0x64 &&
    groups[1] === 0xff9b &&
    (groups[2] === 1 || groups.slice(2, 6).every((g) => g === 0))
  )
    return isPrivateIPv4(embedded());
  return false;
}

/**
 * SSRF guard for catalog photo URLs (Codex finding 5): reject anything that could point the
 * container at itself or the private network before we ever fetch it. Returns a short reason
 * or null. ponytail: literal addresses only, a hostname that *resolves* to a private address
 * (DNS rebinding) is out of scope for a six-person internal tool; add a resolve-and-check if
 * this ever takes untrusted catalogs from outside the customer.
 */
export function photoUrlProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "is not a valid URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return "uses an unsupported protocol";
  if (u.username || u.password) return "must not contain credentials";
  const hostname = u.hostname.toLowerCase();
  const stripped =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  // DNS allows one trailing dot ("localhost.") as a root-anchored name; strip it before any
  // comparison so it can't slip past the localhost/IP checks below.
  const bare = stripped.endsWith(".") ? stripped.slice(0, -1) : stripped;
  if (bare === "localhost" || bare.endsWith(".localhost"))
    return "points at localhost";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    if (isPrivateIPv4(bare)) return "points at a private or loopback address";
  } else if (bare.includes(":") && isPrivateIPv6(bare)) {
    return "points at a private or loopback address";
  }
  return null;
}

// The customer's photo host returns 403 to plain clients; a browser UA gets 200.
export async function fetchPhoto(url: string): Promise<Buffer> {
  const problem = photoUrlProblem(url);
  // Covers rows imported before this guard existed, not just newly-imported CSVs.
  if (problem) throw new PhotoError(problem, false);
  let current = url;
  let redirects = 0;
  let res: Response;
  // Codex finding (redirects): the built-in `follow` mode would chase an allowed URL straight
  // into a private redirect target, so we take redirects manually and re-run the SSRF guard
  // on every hop before ever fetching it.
  for (;;) {
    try {
      res = await fetch(current, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // Timeout, abort or a dead socket: the host may well answer on the next tick.
      throw new PhotoError(
        `photo not reachable (${e instanceof Error ? e.message : String(e)})`,
        true,
      );
    }
    if (res.status < 300 || res.status >= 400) break;
    redirects++;
    if (redirects > 3)
      throw new PhotoError("photo redirects too many times", false);
    const location = res.headers.get("location");
    if (!location)
      throw new PhotoError(`photo not reachable (HTTP ${res.status})`, false);
    const next = new URL(location, current).toString();
    const nextProblem = photoUrlProblem(next);
    if (nextProblem) throw new PhotoError(nextProblem, false);
    current = next;
  }
  if (!res.ok)
    throw new PhotoError(
      `photo not reachable (HTTP ${res.status})`,
      res.status >= 500,
    );
  const buf = Buffer.from(await res.arrayBuffer());
  // A 200 HTML error page would otherwise be base64'd into a paid Luma attempt (Codex, Task 4).
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff)
    throw new PhotoError("photo is not a JPEG", false);
  // ponytail: post-read cap, catalog photos are ~400 KB; stream-and-abort if a host ever lies.
  if (buf.length > MAX_PHOTO_BYTES)
    throw new PhotoError(
      `photo too large (${Math.round(buf.length / 1e6)} MB)`,
      false,
    );
  return buf;
}
