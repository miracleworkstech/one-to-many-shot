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

// The customer's photo host returns 403 to plain clients; a browser UA gets 200.
export async function fetchPhoto(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    // Timeout, abort or a dead socket: the host may well answer on the next tick.
    throw new PhotoError(
      `photo not reachable (${e instanceof Error ? e.message : String(e)})`,
      true,
    );
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
