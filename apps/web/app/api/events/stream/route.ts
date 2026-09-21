import { addHubListener, type HubEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/events/stream — SSE live tail backed by Postgres LISTEN/NOTIFY. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      controller.enqueue(enc.encode(`event: ready\ndata: {"ok":true}\n\n`));
      send("ready", { ok: true });

      const unsubscribe = await addHubListener((event: HubEvent) => send("hook", event));
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      cleanup = close;
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
