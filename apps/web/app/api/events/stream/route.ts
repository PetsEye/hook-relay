// SSE live-tail stub. Next milestone streams persisted events/deliveries from Postgres.
export const dynamic = "force-dynamic";

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`event: ready\ndata: {"ok":true}\n\n`));
      const timer = setInterval(() => {
        controller.enqueue(enc.encode(`event: ping\ndata: {"t":${Date.now()}}\n\n`));
      }, 15_000);
      // Best-effort cleanup; the runtime closes the stream on disconnect.
      (controller as unknown as { _timer?: unknown })._timer = timer;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
