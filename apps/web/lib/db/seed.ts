import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sign } from "hookrelay-js";
import { getDb } from "./client";
import { endpoints, sources, workspaces } from "./schema";

const DEMO_SECRET = process.env.DEMO_SIGNING_SECRET ?? "demo_secret_local_only";

async function main(): Promise<void> {
  const db = getDb();

  await db.insert(workspaces).values({ id: "ws_demo", name: "Demo workspace" }).onConflictDoNothing();

  await db
    .insert(sources)
    .values({ id: "demo", workspaceId: "ws_demo", name: "Demo source", signingSecret: DEMO_SECRET })
    .onConflictDoNothing();

  const existing = await db.select().from(endpoints).where(eq(endpoints.sourceId, "demo")).limit(1);
  if (existing.length === 0) {
    await db
      .insert(endpoints)
      .values({ id: "ep_demo", sourceId: "demo", url: "https://example.com/hooks/demo" })
      .onConflictDoNothing();
  }

  const body = JSON.stringify({ hello: "world" });
  const signature = await sign(DEMO_SECRET, body);

  console.log("[seed] demo workspace ready");
  console.log(`[seed] source=demo secret=${DEMO_SECRET}`);
  console.log("[seed] try it:");
  console.log(
    `curl -X POST localhost:3000/api/ingest/demo -H 'content-type: application/json' -H 'x-hookrelay-signature: ${signature}' -d '${body}'`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
