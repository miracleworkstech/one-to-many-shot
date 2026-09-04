import { env } from "./env";
import {
  LumaError,
  buildFailure,
  invalidResponse,
  statusError,
} from "./luma-errors";
import type { LumaFailureCode } from "./luma-errors";

export {
  LUMA_ERROR_CODES,
  LumaError,
  LumaBudgetError,
  LumaRateLimitError,
  LUMA_FAILURE_CODES,
} from "./luma-errors";
export type { LumaErrorCode, LumaFailureCode } from "./luma-errors";

const API = "https://agents.lumalabs.ai/v1";

export const GENERATION_STATES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
export type GenerationState = (typeof GENERATION_STATES)[number];

interface LumaResponse {
  id: string;
  state: string;
  output?: { url?: unknown }[];
  failure_code?: string;
  failure_reason?: string;
}

function isLumaResponse(v: unknown): v is LumaResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === "string" &&
    (v as Record<string, unknown>).id !== "" &&
    typeof (v as Record<string, unknown>).state === "string"
  );
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<LumaResponse> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.lumaKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    text = await res.text(); // a body that dies mid-stream is a network failure too
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const detail = err instanceof Error ? err.message : String(err);
    if (name === "AbortError" || name === "TimeoutError")
      throw new LumaError({
        code: "timeout",
        userMessage: "Luma did not answer within 30 s. Retrying.",
        detail,
        retryable: true,
      });
    throw new LumaError({
      code: "network",
      userMessage: "Could not reach Luma. Retrying.",
      detail,
      retryable: true,
    });
  }
  if (!res.ok)
    throw statusError(res.status, text, res.headers.get("Retry-After"));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  // ponytail: no id/state is treated the same as invalid JSON (both mean "not a generation")
  if (!isLumaResponse(json))
    throw invalidResponse(text.slice(0, 200), res.status);
  return json;
}

export async function submitEdit(args: {
  prompt: string;
  jpegBase64: string;
}): Promise<string> {
  const gen = await call("POST", "/generations", {
    type: "image_edit",
    model: "uni-1",
    prompt: args.prompt,
    output_format: "jpeg",
    source: { data: args.jpegBase64, media_type: "image/jpeg" },
  });
  return gen.id;
}

export async function getGeneration(id: string): Promise<{
  state: GenerationState;
  url?: string;
  failure?: {
    code: LumaFailureCode;
    userMessage: string;
    retryable: boolean;
    detail: string;
  };
}> {
  const g = await call("GET", `/generations/${id}`);
  if (!GENERATION_STATES.includes(g.state as GenerationState))
    throw invalidResponse(g.state);
  const state = g.state as GenerationState;
  const rawUrl = g.output?.[0]?.url;
  const url = typeof rawUrl === "string" && rawUrl ? rawUrl : undefined;
  // A completed generation always carries output; without it the worker would re-poll forever.
  if (state === "completed" && !url)
    throw invalidResponse(`generation ${id} completed without an output url`);

  return {
    state,
    url,
    failure:
      state === "failed"
        ? buildFailure(g.failure_code, g.failure_reason)
        : undefined,
  };
}
