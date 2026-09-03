import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

type P = {
  sku: string;
  name: string;
  category: string;
  color: string;
  material: string;
  notes: string;
};

// ponytail: template fallback when no key; good enough to unblock, generic by design.
const TEMPLATES: Record<string, string> = {
  Ceramics:
    "on a linen-covered breakfast table by a window, soft morning light",
  Textiles: "draped casually over a neutral sofa in a bright living room",
  Kitchen: "on a wooden kitchen counter mid-use, natural daylight",
  Decor: "on a styled shelf with a plant and a book, warm afternoon light",
  Bath: "on a bathroom counter with a folded towel and soft window light",
  Glassware: "on an outdoor table at golden hour with condensation",
};
const fallback = (p: P) =>
  TEMPLATES[p.category] ??
  "styled in a calm, minimal home setting with natural light";

// ponytail: 50/request keeps each response's JSON small enough to finish
// inside max_tokens — at the plan's ~300-product catalog a single unchunked
// request truncates mid-JSON and every product falls back to a template.
// Sequential (not parallel) chunks: simplest thing that's correct at this
// scale; move to a bounded concurrent queue if the catalog grows past ~1500.
const CHUNK_SIZE = 50;

export async function suggestIdeas(
  products: P[],
): Promise<Map<string, string>> {
  const out = new Map(products.map((p) => [p.sku, fallback(p)]));
  if (!env.anthropicKey || products.length === 0) return out;
  const client = new Anthropic({
    apiKey: env.anthropicKey,
    defaultHeaders: env.anthropicWorkspaceId
      ? { "anthropic-workspace-id": env.anthropicWorkspaceId }
      : undefined,
  });
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    await suggestChunk(client, products.slice(i, i + CHUNK_SIZE), out);
  }
  return out;
}

async function suggestChunk(
  client: Anthropic,
  chunk: P[],
  out: Map<string, string>,
): Promise<void> {
  const list = chunk
    .map(
      (p) =>
        `${p.sku} | ${p.name} | ${p.category} | ${p.color} | ${p.material} | notes: ${p.notes || "-"}`,
    )
    .join("\n");
  const prompt = `You write shot ideas for a small home-goods brand's product photos: the product placed in a real, lived-in scene. Style: short, lowercase, comma-separated fragments like "morning kitchen counter, steam, warm light" or "holiday mantel with evergreen". One idea per product, specific to the product and material, no people, no text. Respond with JSON only: {"<SKU>": "<idea>", ...}.\n\nProducts:\n${list}`;
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const json = JSON.parse(
      text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
    ) as Record<string, string>;
    for (const p of chunk)
      if (typeof json[p.sku] === "string" && json[p.sku].trim())
        out.set(p.sku, json[p.sku].trim());
  } catch (e) {
    console.warn(
      `suggestIdeas: falling back to templates for ${chunk.length} product(s):`,
      (e as Error).message,
    );
  }
}
