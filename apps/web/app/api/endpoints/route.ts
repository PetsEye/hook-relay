import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { endpoints } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const Create = z.object({
  sourceId: z.string().min(1).max(128),
  url: z.string().url().max(2048),
  id: z.string().regex(/^[a-z0-9-]+$/).max(128).optional(),
});

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
