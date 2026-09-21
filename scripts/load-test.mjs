#!/usr/bin/env node
// Load test: hammers POST /api/ingest/:source with signed bodies and reports
// req/sec, p50/p95/p99 latency and status mix. Zero deps, concurrent workers.
//
//   node scripts/load-test.mjs [--url http://localhost:3000/api/ingest/demo]
//                              [--secret demo_secret_local_only]
//                              [--duration 30] [--concurrency 50] [--rate 500]
import { sign } from "hookrelay-js";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const URL = arg("url", process.env.HOOKRELAY_WEB ? `${process.env.HOOKRELAY_WEB}/api/ingest/demo` : "http://localhost:3000/api/ingest/demo");
const SECRET = arg("secret", process.env.DEMO_SIGNING_SECRET ?? "demo_secret_local_only");
const DURATION = Number(arg("duration", 30));
const CONCURRENCY = Number(arg("concurrency", 50));
const TARGET_RATE = Number(arg("rate", 500)); // requests/sec target

const latencies = [];
const counts = { "2xx": 0, "4xx": 0, "429": 0, "5xx": 0, errors: 0 };
let sent = 0;

process.on("SIGINT", () => {
  report();
  process.exit(0);
});

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function report() {
  const sorted = latencies.sort((a, b) => a - b);
  const rps = sent / DURATION;
  console.log("\n=== hookrelay load test ===");
  console.log(`target:     ${URL}`);
  console.log(`duration:   ${DURATION}s, concurrency ${CONCURRENCY}`);
  console.log(`requests:   ${sent} (${rps.toFixed(0)} rps)`);
  console.log(`p50:        ${percentile(sorted, 50)}ms`);
  console.log(`p95:        ${percentile(sorted, 95)}ms`);
  console.log(`p99:        ${percentile(sorted, 99)}ms`);
  console.log(`statuses:   ${JSON.stringify(counts)}`);
}

async function worker(id) {
  const interval = 1000 / (TARGET_RATE / CONCURRENCY);
  const end = Date.now() + DURATION * 1000;
  while (Date.now() < end) {
    const started = performance.now();
    const body = JSON.stringify({ worker: id, i: Math.random(), ts: Date.now() });
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hookrelay-signature": await sign(SECRET, body),
          "idempotency-key": `lt-${id}-${sent}-${Math.random().toString(36).slice(2, 8)}`,
        },
        body,
      });
      const ms = performance.now() - started;
      latencies.push(ms);
      sent++;
      if (res.status === 429) counts["429"]++;
      else if (res.status < 300) counts["2xx"]++;
      else if (res.status < 500) counts["4xx"]++;
      else counts["5xx"]++;
      // drain body
      await res.arrayBuffer().catch(() => {});
    } catch {
      counts.errors++;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

console.log(`[load-test] warming up: ${CONCURRENCY} workers → ${TARGET_RATE} rps target for ${DURATION}s`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
report();
