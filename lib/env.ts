/** A non-numeric value falls back to the default rather than becoming NaN, which would silently disable every cap. */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? n : d;
};
export const env = {
  dataDir: process.env.DATA_DIR ?? "./data-local",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  accessToken: process.env.ACCESS_TOKEN ?? "",
  lumaKey: process.env.LUMA_AGENTS_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  slackWebhook: process.env.SLACK_WEBHOOK_URL ?? "",
  costPerImage: num(process.env.LUMA_COST_PER_IMAGE_USD, 0.0434),
  candidatesPerProduct: num(process.env.CANDIDATES_PER_PRODUCT, 2),
  maxInFlight: num(process.env.MAX_IMAGES_IN_FLIGHT, 40),
  maxTotalSpend: num(process.env.MAX_TOTAL_SPEND_USD, 25),
  lumaConcurrency: num(process.env.LUMA_CONCURRENCY, 4),
  tickMs: num(process.env.WORKER_TICK_MS, 5000),
};

/** Call at server start, never at build: Next sets NODE_ENV=production during `next build` too. */
export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  for (const k of ["LUMA_AGENTS_API_KEY", "ACCESS_TOKEN"] as const)
    if (!process.env[k]) throw new Error(`Missing required env var ${k}`);
}
