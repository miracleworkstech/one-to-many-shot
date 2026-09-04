const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
export const MAX_PHOTO_BYTES = 15_000_000;
// The customer's photo host returns 403 to plain clients; a browser UA gets 200.
export async function fetchPhoto(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`photo not reachable (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A 200 HTML error page would otherwise be base64'd into a paid Luma attempt (Codex, Task 4).
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff)
    throw new Error("photo is not a JPEG");
  // ponytail: post-read cap, catalog photos are ~400 KB; stream-and-abort if a host ever lies.
  if (buf.length > MAX_PHOTO_BYTES)
    throw new Error(`photo too large (${Math.round(buf.length / 1e6)} MB)`);
  return buf;
}
