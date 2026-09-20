import type Redis from "ioredis";
import { getRedis } from "./redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/** Minimal store interface so tests can inject an in-memory fake. */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const redisStore = (redis: Redis): RateLimitStore => ({
  incr: (key) => redis.incr(key),
  expire: (key, seconds) => redis.expire(key, seconds),
});

const memory = new Map<string, { count: number; resetAt: number }>();
export const memoryStore: RateLimitStore = {
  async incr(key) {
    const now = Date.now();
    const cur = memory.get(key);
    if (!cur || cur.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + 60_000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  },
  async expire() {
    return 1;
  },
};

export function resetMemoryStore(): void {
  memory.clear();
}

/**
 * Fixed-window rate limiter. Fail-open: any Redis error allows the request
 * (ingest availability beats strictness; abuse is visible in the dashboard).
 */
export async function checkRateLimit(
  key: string,
  limitPerMin: number,
  store?: RateLimitStore,
): Promise<RateLimitResult> {
  const active: RateLimitStore | undefined = store ?? tryRedisStore();
  if (!active) return { allowed: true, remaining: limitPerMin };
  try {
    const count = await active.incr(`ratelimit:${key}`);
    if (count === 1) await active.expire(`ratelimit:${key}`, 60);
    return { allowed: count <= limitPerMin, remaining: Math.max(0, limitPerMin - count) };
  } catch (err) {
    console.error("[ratelimit] store error, failing open", err);
    return { allowed: true, remaining: limitPerMin };
  }
}

function tryRedisStore(): RateLimitStore | undefined {
  try {
    return redisStore(getRedis());
  } catch {
    return undefined;
  }
}
