// Notification policy: one Slack message per settled batch, never a message per image.
import { db, st, inStates } from "./db";
import { env } from "./env";
import { notifySlack } from "./slack";

/**
 * Sends when nothing is in flight and a candidate has completed since the last message.
 * The watermark is the highest completed candidate id, not a timestamp: candidate ids are
 * monotonic, so two batches enqueued in the same second cannot swallow each other's ping.
 */
export async function notifyIfBatchReady() {
  const d = db();
  const pending = (
    d
      .prepare(
        `select count(*) as n from candidates where state in ${inStates("queued", "processing")}`,
      )
      .get() as { n: number }
  ).n;
  if (pending > 0) return;
  const { last_notified_id } = d
    .prepare("select last_notified_id from settings")
    .get() as { last_notified_id: number };
  const ready = d
    .prepare(
      `select count(distinct sku) as skus, coalesce(max(id), 0) as maxId from candidates where state = ${st("completed")}`,
    )
    .get() as { skus: number; maxId: number };
  if (!ready.skus || ready.maxId <= last_notified_id) return;
  await notifySlack(
    `${ready.skus} product${ready.skus === 1 ? "" : "s"} ready to review: ${env.appUrl}/?k=${env.accessToken}`,
  );
  // ponytail: the watermark moves even if Slack was down (notifySlack swallows), so a lost
  // ping is not retried. The images are on the status page either way.
  d.prepare("update settings set last_notified_id = ?").run(ready.maxId);
}
