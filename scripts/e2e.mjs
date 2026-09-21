#!/usr/bin/env node
// E2E: ingest → deliver → retry → replay happy path.
//
// Prereqs: docker compose -f infra/docker-compose.yml up -d
//          pnpm --filter @hook-relay/web db:migrate db:seed
//          web on :3000, worker running with fast retries:
//            RETRY_DELAYS_SEC=2,2,2,2,2 pnpm --filter @hook-relay/worker dev
// Run:     node scripts/e2e.mjs
import { createServer } from "node:http";
import { sign } from "hookrelay-js";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const SECRET = process.env.DEMO_SIGNING_SECRET ?? "demo_secret_local_only";
const RECEIVER_PORT = Number(process.env.E2E_RECEIVER_PORT ?? 9201);
const RECEIVER_URL = `http://localhost:${RECEIVER_PORT}/hook`;
const DEAD_URL = `http://localhost:59999/hook`;
const ENDPOINT_ID = process.env.E2E_ENDPOINT_ID ?? "ep_e2e";

let received = 0;
const receiver = createServer((req, res) => {
  received++;
  res.writeHead(200).end('{"ok":true}');
  console.log(`  receiver: delivery #${received}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(label, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) {
    console.error(`E2E FAILED at: ${label}`);
    process.exit(1);
  }
}

async function upsertEndpoint(url) {
  const res = await fetch(`${WEB}/api/endpoints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId: "demo", url, id: ENDPOINT_ID }),
  });
  if (res.ok) return;
  const put = await fetch(`${WEB}/api/endpoints/${ENDPOINT_ID}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!put.ok) throw new Error(`cannot create/retarget endpoint: ${put.status}`);
}

async function ingest(payload, idemKey) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${WEB}/api/ingest/demo`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hookrelay-signature": await sign(SECRET, body),
      "idempotency-key": idemKey,
    },
    body,
  });
  if (res.status !== 202) throw new Error(`ingest rejected: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getDelivery(eventId) {
  const list = await (await fetch(`${WEB}/api/events?q=${eventId}`)).json();
  return list.events?.[0]?.deliveries?.[0];
}

async function waitFor(eventId, predicate, label, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const delivery = await getDelivery(eventId);
    if (delivery && predicate(delivery)) return delivery;
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label} (event ${eventId})`);
}

async function main() {
  console.log("hookrelay e2e");
  await new Promise((r) => receiver.listen(RECEIVER_PORT, r));
  console.log(`  receiver on :${RECEIVER_PORT}`);

  stage1: {
    await upsertEndpoint(RECEIVER_URL);
    console.log("  endpoint upserted");
  }

  // Stage 1: ingest → success in one shot.
  const { eventId, deliveries } = await ingest({ e2e: "happy", at: Date.now() }, `e2e-ok-${Date.now()}`);
  const okDelivery = await waitFor(eventId, (d) => d.status === "success", "first success", 20_000);
  step("ingest → delivered on first attempt", okDelivery.status === "success" && okDelivery.attempts === 1, `attempts=${okDelivery.attempts}`);
  step("receiver captured delivery", received >= 1, `count=${received}`);
  void deliveries;

  // Stage 2: dedupe — replayed idempotency key returns the original receipt.
  const idem = `e2e-dup-${Date.now()}`;
  const first = await ingest({ e2e: "dup", at: Date.now() }, idem);
  const second = await ingest({ e2e: "dup", at: Date.now() }, idem);
  step("idempotent dedupe", second.deduped === true && second.eventId === first.eventId, `eventId=${second.eventId?.slice(0, 8)}`);

  // Stage 3: failure → retry → replay → success.
  await upsertEndpoint(DEAD_URL);
  const failing = await ingest({ e2e: "paperclip", at: Date.now() }, `e2e-fail-${Date.now()}`);
  const failed = await waitFor(failing.eventId, (d) => d.attempts >= 2 || d.status === "dlq", "at least one retry", 30_000);
  step("failure path reaches attempt ≥2", failed.attempts >= 2, `status=${failed.status} attempts=${failed.attempts} err=${failed.lastError}`);

  await upsertEndpoint(RECEIVER_URL);
  const before = received;
  const replayRes = await fetch(`${WEB}/api/deliveries/${failed.id}/replay`, { method: "POST" });
  step("replay accepted", replayRes.status === 202, `http=${replayRes.status}`);
  const replayed = await waitFor(failing.eventId, (d) => d.status === "success", "replay success", 30_000);
  step("replay delivered after retarget", replayed.status === "success", `attempts reset to 1 + worker run`);
  await sleep(500);
  step("receiver got the replayed webhook", received > before, `count=${received}`);

  console.log("E2E PASSED (ingest → deliver → retry → replay → success)");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[e2e] fatal: ${err.message}`);
  process.exit(1);
});
process.on("exit", () => receiver.close());
