import Redis from "ioredis";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __hookrelayRedis: Redis | undefined;
}

export function getRedis(): Redis {
  if (!globalThis.__hookrelayRedis) {
    const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false });
    redis.on("error", (err) => console.error("[redis] error", err));
    globalThis.__hookrelayRedis = redis;
  }
  return globalThis.__hookrelayRedis;
}
