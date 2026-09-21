import { getPool } from "./db.js";

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

/** NOTIFY payload is capped at 8000 bytes; callers keep payloads small. */
export async function publishHub(event: HubEvent): Promise<void> {
  try {
    await getPool().query("SELECT pg_notify($1, $2)", [HUB_CHANNEL, JSON.stringify(event)]);
  } catch (err) {
    console.error("[realtime] publish failed", err);
  }
}
