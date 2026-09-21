import { getPool } from "./db/client";

export const HUB_CHANNEL = "hookrelay_events";

export type HubEvent =
  | { type: "event.created"; eventId: string; sourceId: string; payloadPreview: string; createdAt: string }
  | {
      type: "delivery.updated";
      deliveryId: string;
      eventId: string;
      status: string;
      attempts: number;
      latencyMs: number | null;
      responseCode: number | null;
    };

/** NOTIFY payload is capped at 8000 bytes — trim previews defensively. */
export function truncateForNotify(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export async function publishHub(event: HubEvent): Promise<void> {
  try {
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload, "utf8") > 8000) {
      // Should not happen after truncation below, but stay fail-open.
      return;
    }
    await getPool().query("SELECT pg_notify($1, $2)", [HUB_CHANNEL, payload]);
  } catch (err) {
    // Dashboards tolerate missed notifications; never break ingest for cosmetics.
    console.error("[realtime] publish failed", err);
  }
}

const listeners = new Set<(event: HubEvent) => void>();

/** Single shared LISTEN client for the SSE endpoint (per web process). */
let listenClient: import("pg").PoolClient | undefined;

export async function addHubListener(fn: (event: HubEvent) => void): Promise<() => void> {
  listeners.add(fn);
  if (!listenClient) {
    const client = await getPool().connect();
    listenClient = client;
    await client.query(`LISTEN ${HUB_CHANNEL}`);
    client.on("notification", (msg) => {
      if (msg.channel !== HUB_CHANNEL || !msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as HubEvent;
        for (const listener of listeners) listener(event);
      } catch {
        // malformed payload — ignore
      }
    });
    client.on("error", () => {
      if (listenClient === client) listenClient = undefined;
    });
  }
  return () => {
    listeners.delete(fn);
  };
}
