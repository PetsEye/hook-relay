import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import { getDb } from "./db.js";
import { publishHub } from "./realtime.js";
import { deliveries, endpoints, events, sources, type DeliveryStatus } from "./schema.js";
import { applyTransform, getActiveTransform } from "./transform.js";

export const MAX_RETRIES = 5;
/** Total delivery attempts = initial + MAX_RETRIES. */
export const MAX_ATTEMPTS = MAX_RETRIES + 1;
export const DELIVERY_TIMEOUT_MS = Number(process.env.DELIVERY_TIMEOUT_MS ?? 10_000);
/** 1m, 5m, 15m, 1h, 6h — overridable via `RETRY_DELAYS_SEC=10,20,...` for tests/E2E. */
export const RETRY_DELAYS_SEC: readonly number[] = (() => {
  const raw = process.env.RETRY_DELAYS_SEC;
  if (!raw) return [60, 300, 900, 3600, 21_600];
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : [60, 300, 900, 3600, 21_600];
})();

export interface DeliverJobData {
  deliveryId: string;
  eventId: string;
}

function signDelivery(secret: string, body: string, timestamp: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function computeNextRetry(attempt: number): Date | null {
  // attempt = number of failed attempts so far (1-based).
  // Attempt 5 failed → retry in 6h; attempt 6 failed → DLQ.
  if (attempt >= MAX_ATTEMPTS) return null;
  const idx = Math.min(attempt, RETRY_DELAYS_SEC.length) - 1;
  const delaySec = RETRY_DELAYS_SEC[idx] ?? RETRY_DELAYS_SEC.at(-1)!;
  return new Date(Date.now() + delaySec * 1000);
}

export interface AttemptResult {
  ok: boolean;
  responseCode: number | null;
  latencyMs: number;
  error: string | null;
}

export async function attemptHttpDelivery(url: string, body: string, secret: string): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "hookrelay/0.1 (+https://github.com/erikpecaj/hookrelay)",
        "x-hookrelay-signature": signDelivery(secret, body, Math.floor(started / 1000).toString()),
      },
      body,
      signal: controller.signal,
    });
    // Consume the body so the socket is released.
    await res.arrayBuffer().catch(() => {});
    const ok = res.status >= 200 && res.status < 300;
    return { ok, responseCode: res.status, latencyMs: Date.now() - started, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout after ${DELIVERY_TIMEOUT_MS}ms`
          : err.message
        : "unknown error";
    return { ok: false, responseCode: null, latencyMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProcessContext {
  /** Test hook: overrides the HTTP attempt entirely. */
  attemptFn?: typeof attemptHttpDelivery;
}

/**
 * Delivery attempt lifecycle (pure enough to unit test):
 * load delivery+event+endpoint+source → POST signed →
 * success → `success`; failure → `failed` + next_retry_at, or `dlq` after MAX_ATTEMPTS.
 */
export async function processDeliveryJob(job: Job<DeliverJobData>, ctx: ProcessContext = {}): Promise<string> {
  const db = getDb();
  const attempt = ctx.attemptFn ?? attemptHttpDelivery;
  const { deliveryId, eventId } = job.data;

  const [row] = await db
    .select({
      delivery: deliveries,
      event: events,
      endpoint: endpoints,
      source: sources,
    })
    .from(deliveries)
    .innerJoin(events, eq(deliveries.eventId, events.id))
    .innerJoin(endpoints, eq(deliveries.endpointId, endpoints.id))
    .innerJoin(sources, eq(events.sourceId, sources.id))
    .where(eq(deliveries.id, deliveryId))
    .limit(1);

  if (!row) {
    throw new Error(`delivery ${deliveryId} not found`);
  }

  const { delivery, event, endpoint, source } = row;
  if (delivery.status === "success" || delivery.status === "dlq") {
    return `delivery ${deliveryId} already ${delivery.status}, skipping`;
  }

  const transform = await getActiveTransform(endpoint.id);
  const applied = applyTransform(transform, event.payload ?? {});
  const body = JSON.stringify(applied.body);
  const result = await attempt(endpoint.url, body, source.signingSecret);

  const attempts = delivery.attempts + 1;

  if (result.ok) {
    await db
      .update(deliveries)
      .set({
        status: "success",
        attempts,
        latencyMs: result.latencyMs,
        responseCode: result.responseCode,
        lastError: null,
        nextRetryAt: null,
      })
      .where(eq(deliveries.id, deliveryId));
    void publishHub({
      type: "delivery.updated",
      deliveryId,
      eventId,
      status: "success",
      attempts,
      latencyMs: result.latencyMs,
      responseCode: result.responseCode,
    });
    return `delivered ${deliveryId} in ${result.latencyMs}ms (HTTP ${result.responseCode})`;
  }

  const nextRetryAt = computeNextRetry(attempts);
  const status: DeliveryStatus = nextRetryAt ? "failed" : "dlq";
  await db
    .update(deliveries)
    .set({
      status,
      attempts,
      latencyMs: result.latencyMs,
      responseCode: result.responseCode,
      lastError: result.error,
      nextRetryAt,
    })
    .where(eq(deliveries.id, deliveryId));
  void publishHub({
    type: "delivery.updated",
    deliveryId,
    eventId,
    status,
    attempts,
    latencyMs: result.latencyMs,
    responseCode: result.responseCode,
  });

  if (!nextRetryAt) {
    console.error(`[worker] delivery ${deliveryId} moved to DLQ after ${attempts} attempts: ${result.error}`);
    return `dlq ${deliveryId}`;
  }

  // Throw so BullMQ schedules the retry with the matching backoff slot.
  const delayMs = RETRY_DELAYS_SEC[Math.min(attempts, RETRY_DELAYS_SEC.length) - 1]! * 1000;
  throw Object.assign(new Error(`attempt ${attempts} failed: ${result.error}`), { delayMs, attempts });
}

export { safeEqual };
