// Transport only. Policy (when to send) lives in lib/notify.ts.
import { env } from "./env";

export async function notifySlack(text: string) {
  if (!env.slackWebhook) return;
  try {
    await fetch(env.slackWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // A missed Slack ping must never stop the worker; the images are already on disk.
    console.warn("slack:", e instanceof Error ? e.message : String(e));
  }
}
