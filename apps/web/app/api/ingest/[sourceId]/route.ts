import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { verify } from "hookrelay-js";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { deliveries, endpoints, events, sources } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getIdempotencyKey, getSignature, isPostgresUniqueViolation, isTooLarge } from "@/lib/ingest";
import { enqueueDelivery } from "@/lib/queue";
import { checkRateLimit } from "@/lib/ratelimit";

const Params = z.object({ sourceId: z.string().min(1).max(128) });

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/:sourceId — durable intake.
 * verify HMAC → rate-limit → parse → dedupe by Idempotency-Key →
 * persist event + fan-out deliveries → enqueue BullMQ jobs.
 */
export async function POST(req: Request, ctx: { params: { sourceId: string } }) {
  const parsed = Params.safeParse(ctx.params);
  if (!parsed.success) return NextResponse.json({ error: "invalid source" }, { status: 400 });
  const { sourceId } = parsed.data;

  const db = getDb();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) return NextResponse.json({ error: "unknown source", sourceId }, { status: 404 });

  const limited = await checkRateLimit(`ingest:${sourceId}`, env.RATE_LIMIT_PER_MIN);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate limited", retryAfterSec: 60 }, { status: 429 });
  }

  const rawBody = await req.text();
  if (isTooLarge(rawBody, env.MAX_PAYLOAD_BYTES)) {
    return NextResponse.json({ error: "payload too large", maxBytes: env.MAX_PAYLOAD_BYTES }, { status: 413 });
  }

  const signature = getSignature(req.headers);
  if (!signature || !(await verify(source.signingSecret, rawBody, signature))) {
    return NextResponse.json({ error: "invalid signature", header: "x-hookrelay-signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const idempotencyKey = getIdempotencyKey(req.headers);

  // Idempotent replay: same (source, key) returns the original receipt.
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(events)
      .where(and(eq(events.sourceId, sourceId), eq(events.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      const rows = await db.select().from(deliveries).where(eq(deliveries.eventId, existing.id));
      return NextResponse.json({ ok: true, deduped: true, eventId: existing.id, deliveries: rows });
    }
  }

  const eventId = randomUUID();
  try {
    await db.insert(events).values({ id: eventId, sourceId, idempotencyKey, payload });
  } catch (err) {
    // Lost the insert race with an identical request — return the winner's receipt.
    if (idempotencyKey && isPostgresUniqueViolation(err)) {
      const [winner] = await db
        .select()
        .from(events)
        .where(and(eq(events.sourceId, sourceId), eq(events.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (winner) {
        const rows = await db.select().from(deliveries).where(eq(deliveries.eventId, winner.id));
        return NextResponse.json({ ok: true, deduped: true, eventId: winner.id, deliveries: rows });
      }
    }
    throw err;
  }

  const targets = await db.select().from(endpoints).where(eq(endpoints.sourceId, sourceId));
  const receipts = await Promise.all(
    targets.map(async (t) => {
      const deliveryId = randomUUID();
      await db.insert(deliveries).values({
        id: deliveryId,
        eventId,
        endpointId: t.id,
        status: "queued",
        attempts: 0,
      });
      const queued = await enqueueDelivery(deliveryId, eventId);
      return { deliveryId, endpointId: t.id, queued };
    }),
  );

  return NextResponse.json({ ok: true, deduped: false, eventId, deliveries: receipts }, { status: 202 });
}
