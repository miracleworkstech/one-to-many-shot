// Typed error/failure mapping for the Luma client (D11). Split out of lib/luma.ts to keep
// that file under ~200 lines; docs.agents.lumalabs.ai/guides/error-handling is the source.
import { env } from "./env";

/** Luma never echoes the key, but detail/userMessage carry external text; never let it through (Codex). */
const redact = (s: string) =>
  env.lumaKey ? s.split(env.lumaKey).join("[redacted]") : s;

export const LUMA_ERROR_CODES = [
  "auth",
  "budget",
  "forbidden",
  "rate_limited",
  "bad_request",
  "not_found",
  "upstream",
  "timeout",
  "network",
  "invalid_response",
] as const;
export type LumaErrorCode = (typeof LUMA_ERROR_CODES)[number];

export class LumaError extends Error {
  code: LumaErrorCode;
  userMessage: string;
  detail: string;
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
  constructor(opts: {
    code: LumaErrorCode;
    userMessage: string;
    detail: string;
    retryable: boolean;
    retryAfterMs?: number;
    status?: number;
  }) {
    const userMessage = redact(opts.userMessage);
    super(userMessage);
    this.name = "LumaError";
    this.code = opts.code;
    this.userMessage = userMessage;
    this.detail = redact(opts.detail);
    this.retryable = opts.retryable;
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
  }
}
export class LumaBudgetError extends LumaError {}
export class LumaRateLimitError extends LumaError {}

export const LUMA_FAILURE_CODES = [
  "content_moderated",
  "generation_failed",
  "budget_exhausted",
  "output_not_found",
  "image_too_large",
  "unsupported_format",
  "corrupt_input",
  "invalid_request",
  "rate_limited",
  "unknown",
] as const;
export type LumaFailureCode = (typeof LUMA_FAILURE_CODES)[number];

// ponytail: table over a switch; one row per documented failure_code, see D11.
const FAILURE_MESSAGES: Record<
  LumaFailureCode,
  { userMessage: (reason: string) => string; retryable: boolean }
> = {
  content_moderated: {
    userMessage: () =>
      "Luma's moderation blocked this prompt or photo. Edit the idea and try again.",
    retryable: false,
  },
  image_too_large: {
    userMessage: (r) => `Luma could not use the product photo: ${r}.`,
    retryable: false,
  },
  unsupported_format: {
    userMessage: (r) => `Luma could not use the product photo: ${r}.`,
    retryable: false,
  },
  corrupt_input: {
    userMessage: (r) => `Luma could not use the product photo: ${r}.`,
    retryable: false,
  },
  invalid_request: {
    userMessage: (r) => `Luma could not use the product photo: ${r}.`,
    retryable: false,
  },
  budget_exhausted: {
    userMessage: () =>
      "Luma ran out of credits during this generation. Add funds, then press Resume.",
    retryable: false,
  },
  generation_failed: {
    userMessage: () => "Luma failed on its side. Try again.",
    retryable: true,
  },
  output_not_found: {
    userMessage: () => "Luma failed on its side. Try again.",
    retryable: true,
  },
  rate_limited: {
    userMessage: () => "Luma failed on its side. Try again.",
    retryable: true,
  },
  unknown: {
    userMessage: () => "Luma failed on its side. Try again.",
    retryable: true,
  },
};

export function buildFailure(
  failureCode: string | undefined,
  failureReason: string | undefined,
) {
  const code = (LUMA_FAILURE_CODES as readonly string[]).includes(
    failureCode ?? "",
  )
    ? (failureCode as LumaFailureCode)
    : "unknown";
  const reason = failureReason ?? "";
  const spec = FAILURE_MESSAGES[code];
  return {
    code,
    userMessage: spec.userMessage(reason),
    retryable: spec.retryable,
    detail: `${failureCode ?? ""} ${reason}`.trim(),
  };
}

/** Luma's documented error body is {"detail": "<string>"}; fall back to the raw text for logs. */
function rawDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
  } catch {
    // not JSON
  }
  return text.slice(0, 200);
}

export function statusError(
  status: number,
  text: string,
  retryAfterHeader: string | null,
): LumaError {
  const detail = rawDetail(text);
  if (status === 402)
    return new LumaBudgetError({
      code: "budget",
      userMessage: "Luma has no credits left. Add funds, then press Resume.",
      detail,
      retryable: false,
      status,
    });
  if (status === 401)
    return new LumaError({
      code: "auth",
      userMessage:
        "Luma rejected the API key. Fix LUMA_AGENTS_API_KEY, then press Resume.",
      detail,
      retryable: false,
      status,
    });
  if (status === 403)
    return new LumaError({
      code: "forbidden",
      userMessage: "Luma has suspended this API client. Contact Luma support.",
      detail,
      retryable: false,
      status,
    });
  if (status === 429) {
    // Luma documents integer seconds >= 1; anything else (missing, HTTP-date, 0, negative) waits 60 s.
    const seconds = Number(retryAfterHeader);
    const retryAfterMs =
      retryAfterHeader && Number.isFinite(seconds) && seconds > 0
        ? Math.max(1000, seconds * 1000)
        : 60_000;
    const s = retryAfterMs / 1000;
    const userMessage =
      detail === "Too many concurrent jobs"
        ? `Luma is busy with our other jobs. Waiting ${s} s.`
        : `Luma is rate limiting us. Waiting ${s} s.`;
    return new LumaRateLimitError({
      code: "rate_limited",
      userMessage,
      detail,
      retryable: true,
      retryAfterMs,
      status,
    });
  }
  if (status === 400 || status === 413 || status === 422)
    return new LumaError({
      code: "bad_request",
      userMessage: `Luma rejected this request: ${detail}.`,
      detail,
      retryable: false,
      status,
    });
  if (status === 404)
    return new LumaError({
      code: "not_found",
      userMessage: "Luma no longer knows this generation.",
      detail,
      retryable: false,
      status,
    });
  // 502, 503, and any other non-ok status we don't have a specific mapping for.
  return new LumaError({
    code: "upstream",
    userMessage: "Luma is temporarily unavailable. Retrying.",
    detail,
    retryable: true,
    status,
  });
}

export function invalidResponse(detail: string, status?: number): LumaError {
  return new LumaError({
    code: "invalid_response",
    userMessage: "Luma sent an unexpected reply. Retrying.",
    detail,
    retryable: true,
    status,
  });
}
