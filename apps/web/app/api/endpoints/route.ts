import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { endpoints } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const Create = z.object({
  sourceId: z.string().min(1).max(128),
  url: z.string().url().max(2048),
  id: z.string().regex(/^[a-z0-9-]+$/).max(128).optional(),
});

const Update = z.object({ url: z.string().url().max(2048) });

/** POST /api/endpoints — create a delivery target. */
export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { sourceId, url, id } = parsed.data;
  const endpointId = id ?? randomUUID();
  try {
    await getDb().insert(endpoints).values({ id: endpointId, sourceId, url });
  } catch {
    return NextResponse.json({ error: "endpoint create failed (bad sourceId?)" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, endpointId, url }, { status: 201 });
}

/** PUT /api/endpoints/:id — retarget an endpoint (used by replay/E2E flows). */
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const [updated] = await getDb()
    .update(endpoints)
    .set({ url: parsed.data.url })
    .where(eq(endpoints.id, ctx.params.id))
    .returning({ id: endpoints.id, url: endpoints.url });
  if (!updated) return NextResponse.json({ error: "unknown endpoint" }, { status: 404 });
  return NextResponse.json({ ok: true, endpoint: updated });
}
