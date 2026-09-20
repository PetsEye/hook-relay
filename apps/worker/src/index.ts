// Delivery worker scaffold.
// Milestone 3 connects BullMQ (Redis) + Postgres and implements:
// timeout → exponential backoff x5 → DLQ, per-endpoint transforms, HMAC-signed delivery.

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

async function main(): Promise<void> {
  console.log(`[worker] scaffold online (redis=${redisUrl}). Waiting for milestone 3 queue wiring…`);
  // Keep the Railway service healthy until the real Worker boots.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
