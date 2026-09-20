import { Queue } from "bullmq";
import { env } from "./env";
import { getRedis } from "./redis";

export const DELIVERY_QUEUE = "deliveries";

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
    await q.add("deliver", { deliveryId, eventId }, { jobId: deliveryId });
    return true;
  } catch (err) {
    console.error("[queue] enqueue failed", err);
    return false;
  }
}
