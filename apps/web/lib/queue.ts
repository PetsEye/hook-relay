import { Queue } from "bullmq";
import { env } from "./env";
import { getRedis } from "./redis";

export const DELIVERY_QUEUE = "deliveries";
/** initial attempt + 5 retries → DLQ; delays match apps/worker RETRY_DELAYS_SEC. */
export const MAX_DELIVERY_ATTEMPTS = 6;

let queue: Queue | undefined;

export function getDeliveryQueue(): Queue | undefined {
  // Fail-open: ingest must stay up even if Redis is unreachable.
  // Deliveries persist in Postgres as `queued` and get picked up once Redis returns.
  try {
    if (!queue) {
      queue = new Queue(DELIVERY_QUEUE, {
        connection: getRedis(),
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      });
      queue.on("error", (err) => console.error("[queue] error", err));
    }
    return queue;
  } catch (err) {
    console.error("[queue] unavailable, persisting without enqueue", err);
    return undefined;
  }
}

export async function enqueueDelivery(deliveryId: string, eventId: string): Promise<boolean> {
  const q = getDeliveryQueue();
  if (!q) return false;
  try {
    // jobId = deliveryId gives queue-level dedupe for free.
    await q.add(
      "deliver",
      { deliveryId, eventId },
      {
        jobId: deliveryId,
        attempts: MAX_DELIVERY_ATTEMPTS,
        // Delay is decided by the worker's backoffStrategy (1m/5m/15m/1h/6h).
        backoff: { type: "custom" },
      },
    );
    return true;
  } catch (err) {
    console.error("[queue] enqueue failed", err);
    return false;
  }
}
