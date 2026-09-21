import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { transforms } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const Body = z.object({
  code: z.string().min(1).max(10_000),
  /** When true the new version deactivates all previous versions. */
  activate: z.boolean().default(true),
});

/** GET /api/endpoints/:id/transforms — version history, newest first. */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const rows = await getDb()
    .select()
    .from(transforms)
    .where(eq(transforms.endpointId, ctx.params.id))
    .orderBy(desc(transforms.version));
  return NextResponse.json({ transforms: rows });
}

/** POST /api/endpoints/:id/transforms — save a new version (never mutates old ones). */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { code, activate } = parsed.data;

  const db = getDb();
  const [latest] = await db
    .select({ version: transforms.version })
    .from(transforms)
    .where(eq(transforms.endpointId, ctx.params.id))
    .orderBy(desc(transforms.version))
    .limit(1);

  const version = (latest?.version ?? 0) + 1;
  const id = randomUUID();
  await db.insert(transforms).values({ id, endpointId: ctx.params.id, version, code, active: activate });

  if (activate && version > 1) {
    await db
      .update(transforms)
      .set({ active: false })
      .where(and(eq(transforms.endpointId, ctx.params.id), gt(transforms.version, 0), eq(transforms.active, true)));
    // Re-activate only the new one.
    await db.update(transforms).set({ active: true }).where(eq(transforms.id, id));
  }

  return NextResponse.json({ ok: true, id, version, active: activate }, { status: 201 });
}
