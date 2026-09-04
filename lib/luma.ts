import { env } from "./env";

const API = "https://agents.lumalabs.ai/v1";

export const GENERATION_STATES = [
  "queued",
  "processing",
  "completed",
  "failed",
] as const;
export type GenerationState = (typeof GENERATION_STATES)[number];

export class LumaBudgetError extends Error {}
export class LumaRateLimitError extends Error {}

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
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.lumaKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (res.status === 402) throw new LumaBudgetError("Luma: not enough credits");
  if (res.status === 429) throw new LumaRateLimitError("Luma: rate limited");
  if (!res.ok) throw new Error(`Luma ${res.status}: ${text.slice(0, 200)}`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  // ponytail: no id/state is treated the same as invalid JSON (both mean "not a generation")
  if (!isLumaResponse(json))
    throw new Error(`Luma ${res.status}: ${text.slice(0, 200)}`);
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

export async function getGeneration(
  id: string,
): Promise<{ state: GenerationState; url?: string; failure?: string }> {
  const g = await call("GET", `/generations/${id}`);
  if (!GENERATION_STATES.includes(g.state as GenerationState))
    throw new Error(`Luma: unexpected generation state "${g.state}"`);
  const rawUrl = g.output?.[0]?.url;
  const url = typeof rawUrl === "string" && rawUrl ? rawUrl : undefined;
  // A completed generation always carries output; without it the worker would re-poll forever.
  if (g.state === "completed" && !url)
    throw new Error(`Luma: generation ${id} completed without an output url`);
  return {
    state: g.state as GenerationState,
    url,
    failure: g.failure_reason
      ? `${g.failure_code ?? ""} ${g.failure_reason}`.trim()
      : undefined,
  };
}
