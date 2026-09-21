import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { deliveries, endpoints, events, sources } from "@/lib/db/schema";

const Query = z.object({
  q: z.string().max(200).optional(),
  status: z
    .enum(["queued", "delivering", "success", "failed", "dlq"])
    .optional(),
  sourceId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const dynamic = "force-dynamic";

/** GET /api/events — event list with per-endpoint delivery rows for the dashboard. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid query" }, { status: 400 });
  const { q, status, sourceId, limit } = parsed.data;

  const db = getDb();
  const filters = [];
  if (sourceId) filters.push(eq(events.sourceId, sourceId));
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(events.idempotencyKey, like), sql`${events.payload}::text ILIKE ${like}`));
  }

  const rows = await db
    .select({
      event: events,
      sourceName: sources.name,
      delivery: deliveries,
      endpointUrl: endpoints.url,
    })
    .from(events)
    .innerJoin(sources, eq(events.sourceId, sources.id))
    .leftJoin(deliveries, eq(deliveries.eventId, events.id))
    .leftJoin(endpoints, eq(deliveries.endpointId, endpoints.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  // Group joined rows into event objects.
  const byEvent = new Map<
    string,
    {
      id: string;
      sourceId: string;
      sourceName: string;
      idempotencyKey: string | null;
      payload: unknown;
      createdAt: string;
      deliveries: Array<{
        id: string;
        endpointUrl: string | null;
        status: string;
        attempts: number;
        latencyMs: number | null;
        responseCode: number | null;
        lastError: string | null;
        nextRetryAt: string | null;
      }>;
    }
  >();

  for (const row of rows) {
    let item = byEvent.get(row.event.id);
    if (!item) {
      item = {
        id: row.event.id,
        sourceId: row.event.sourceId,
        sourceName: row.sourceName,
        idempotencyKey: row.event.idempotencyKey,
        payload: row.event.payload,
        createdAt: row.event.createdAt.toISOString(),
        deliveries: [],
      };
      byEvent.set(row.event.id, item);
    }
    if (row.delivery) {
      item.deliveries.push({
        id: row.delivery.id,
        endpointUrl: row.endpointUrl ?? null,
        status: row.delivery.status,
        attempts: row.delivery.attempts,
        latencyMs: row.delivery.latencyMs,
        responseCode: row.delivery.responseCode,
        lastError: row.delivery.lastError,
        nextRetryAt: row.delivery.nextRetryAt ? row.delivery.nextRetryAt.toISOString() : null,
      });
    }
  }

  // Optional status filter applies at delivery level after grouping.
  let list = [...byEvent.values()];
  if (status) {
    list = list.filter((e) => e.deliveries.some((d) => d.status === status));
  }

  return NextResponse.json({ events: list });
}
