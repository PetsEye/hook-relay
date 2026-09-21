import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { deliveries } from "@/lib/db/schema";
import { enqueueDelivery } from "@/lib/queue";
import { publishHub } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/** POST /api/deliveries/:id/replay — reset a delivery to `queued` and re-enqueue. */
export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid delivery id" }, { status: 400 });
  }

  const db = getDb();
  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
  if (!delivery) return NextResponse.json({ error: "unknown delivery" }, { status: 404 });

  if (delivery.status === "delivering") {
    return NextResponse.json({ error: "delivery in progress" }, { status: 409 });
  }

  await db
    .update(deliveries)
    .set({ status: "queued", attempts: 0, nextRetryAt: null, lastError: null })
    .where(eq(deliveries.id, id));

  const queued = await enqueueDelivery(id, delivery.eventId, { dedupeByDeliveryId: false });
  void publishHub({
    type: "delivery.updated",
    deliveryId: id,
    eventId: delivery.eventId,
    status: "queued",
    attempts: 0,
    latencyMs: null,
    responseCode: null,
  });

  return NextResponse.json({ ok: queued, deliveryId: id, eventId: delivery.eventId }, { status: queued ? 202 : 503 });
}
