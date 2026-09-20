import { NextResponse } from "next/server";
import { z } from "zod";

const Params = z.object({ sourceId: z.string().min(1).max(128) });

export const dynamic = "force-dynamic";

// P0 stub: validates + echoes. Next milestone persists to Postgres,
// dedupes by Idempotency-Key, and enqueues a BullMQ delivery job.
export async function POST(req: Request, ctx: { params: { sourceId: string } }) {
  const parsed = Params.safeParse(ctx.params);
  if (!parsed.success) return NextResponse.json({ error: "invalid source" }, { status: 400 });

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const idempotencyKey = req.headers.get("idempotency-key") ?? req.headers.get("x-idempotency-key");

  return NextResponse.json(
    {
      ok: true,
      queued: false,
      scaffold: true,
      sourceId: parsed.data.sourceId,
      idempotencyKey,
      payload,
    },
    { status: 202 },
  );
}
