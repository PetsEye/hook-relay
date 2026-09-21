import { Queue, Worker, type Job } from "bullmq";
import { getDb, getPool } from "./db.js";
import { MAX_ATTEMPTS, processDeliveryJob, RETRY_DELAYS_SEC, type DeliverJobData } from "./processor.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const redisHost = new URL(redisUrl).hostname;
const redisPort = Number(new URL(redisUrl).port) || 6379;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 10);
const QUEUE = "deliveries";

async function handleJob(job: Job<DeliverJobData>): Promise<string> {
  return processDeliveryJob(job);
}

/** Recovery sweep: deliveries stuck in `queued`/`failed` past their retry time
 *  (e.g. Redis was down during ingest) get re-enqueued on boot. */
async function requeueStale(): Promise<number> {
  try {
    const { and, eq, inArray, isNull, lt, or } = await import("drizzle-orm");
    const { deliveries } = await import("./schema.js");
    const db = getDb();
    const stale = await db
      .select({ id: deliveries.id, eventId: deliveries.eventId })
      .from(deliveries)
      .where(
        and(
          inArray(deliveries.status, ["queued", "failed"]),
          or(isNull(deliveries.nextRetryAt), lt(deliveries.nextRetryAt, new Date())),
        ),
      )
      .limit(500);
    if (stale.length === 0) return 0;
    const q = new Queue(QUEUE, { connection: { host: redisHost, port: redisPort } });
    await q.addBulk(
      stale.map((d) => ({
          name: "deliver",
          data: { deliveryId: d.id, eventId: d.eventId } satisfies DeliverJobData,
          opts: { jobId: d.id, attempts: MAX_ATTEMPTS, backoff: { type: "custom" } },
      })),
    );
    await q.close();
    return stale.length;
  } catch (err) {
    console.error("[worker] requeue sweep failed", err);
    return 0;
  }
}

async function main(): Promise<Worker<DeliverJobData>> {
  const worker = new Worker<DeliverJobData>(QUEUE, handleJob, {
    connection: { host: redisHost, port: redisPort },
    concurrency,
    settings: {
      // Ladder: 1m, 5m, 15m, 1h, 6h — indexed by attemptsMade (after failure N, retry in slot N).
      backoffStrategy: (attemptsMade) => {
        const idx = Math.min(attemptsMade, RETRY_DELAYS_SEC.length) - 1;
        return (RETRY_DELAYS_SEC[idx] ?? RETRY_DELAYS_SEC.at(-1)!) * 1000;
      },
    },
  });

  worker.on("completed", (job, result) => {
    console.log(`[worker] ✓ ${job.id}: ${result}`);
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    const made = job.attemptsMade;
    if (made >= MAX_ATTEMPTS) {
      console.error(`[worker] ✗ ${job.id}: exhausted ${made} attempts → DLQ (${err.message})`);
    } else {
      const nextDelay = RETRY_DELAYS_SEC[Math.min(made, RETRY_DELAYS_SEC.length) - 1];
      console.warn(`[worker] ↻ ${job.id}: attempt ${made}/${MAX_ATTEMPTS} failed, retry in ~${nextDelay}s`);
    }
  });

  worker.on("error", (err) => {
    console.error("[worker] error", err);
  });

  const recovered = await requeueStale();
  console.log(`[worker] online: redis=${redisUrl} concurrency=${concurrency} requeued=${recovered}`);
  return worker;
}

main()
  .then(async (worker) => {
    const shutdown = async (signal: string) => {
      console.log(`[worker] ${signal} received, draining…`);
      await worker.close();
      await getPool().end();
      process.exit(0);
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("[worker] fatal", err);
    process.exit(1);
  });
