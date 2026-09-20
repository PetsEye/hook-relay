// Load-test stub (milestone 5): hammers POST /api/ingest/demo and reports p50/p95.
// Target: 500 rps against the Railway deployment; results go in the README.
const url = process.argv[2] ?? "http://localhost:3000/api/ingest/demo";
console.log(`[load-test] stub — target ${url}; autocannon/k6 wiring lands in milestone 5.`);
