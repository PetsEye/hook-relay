import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sources } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** GET /api/sources — source list for dashboard filters. */
export async function GET() {
  const rows = await getDb()
    .select({ id: sources.id, name: sources.name })
    .from(sources)
    .orderBy(asc(sources.name));
  return NextResponse.json({ sources: rows });
}
