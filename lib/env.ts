/** A non-numeric, zero or negative value falls back to the default: NaN would become a
 * silent NaN comparison, and 0 or less would disable a cap or stall the worker loop. */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : d;
};
/** Counts of images are whole numbers; 1.5 candidates per product is a typo, not a setting. */
const count = (v: string | undefined, d: number) => {
  const n = num(v, d);
  return Number.isInteger(n) ? n : d;
};
export const env = {
  dataDir: process.env.DATA_DIR ?? "./data-local",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  accessToken: process.env.ACCESS_TOKEN ?? "",
  lumaKey: process.env.LUMA_AGENTS_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Identity-linked Anthropic keys are rejected without the workspace they act in. Optional. */
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID ?? "",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
  costPerImage: num(process.env.LUMA_COST_PER_IMAGE_USD, 0.0434),
  candidatesPerProduct: count(process.env.CANDIDATES_PER_PRODUCT, 2),
  maxInFlight: count(process.env.MAX_IMAGES_IN_FLIGHT, 40),
  maxTotalSpend: num(process.env.MAX_TOTAL_SPEND_USD, 25),
  lumaConcurrency: count(process.env.LUMA_CONCURRENCY, 4),
  tickMs: num(process.env.WORKER_TICK_MS, 5000),
};

/** Call at server start, never at build: Next sets NODE_ENV=production during `next build` too. */
export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  for (const k of ["LUMA_AGENTS_API_KEY", "ACCESS_TOKEN", "APP_URL"] as const)
    if (!process.env[k]) throw new Error(`Missing required env var ${k}`);
  const invalidAppUrl = () =>
    new Error(
      "Invalid APP_URL: must be an http(s) origin with no path, e.g. https://shots.example.railway.app",
    );
  let url: URL;
  try {
    url = new URL(process.env.APP_URL ?? "");
  } catch {
    throw invalidAppUrl();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw invalidAppUrl();
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw invalidAppUrl();
}
