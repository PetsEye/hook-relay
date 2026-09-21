# ARCHITECTURE — hook-relay (Railway all-in-one)

## Services (Railway)

| Service | Source | Health | Env |
|---|---|---|---|
| web | `Dockerfile.web` (Next standalone) | `/api/health` | `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` |
| worker | `Dockerfile.worker` (Node) | process liveness | `DATABASE_URL`, `REDIS_URL` |
| postgres | Railway plugin | — | `DATABASE_URL` |
| redis | Railway plugin | — | `REDIS_URL` |

Local mirror: `infra/docker-compose.yml` (postgres:16, redis:7, web:3000, worker).

## Request flow (all live)

1. `POST /api/ingest/:sourceId` looks up the source (404), rate-limits per source (Redis fixed window, fail-open → 429), reads the raw body (413 over `MAX_PAYLOAD_BYTES`), verifies `x-hookrelay-signature` (HMAC-SHA256 via `hookrelay-js` → 401), parses JSON (400).
2. Dedupes by `Idempotency-Key` — repeat requests return the original receipt (`200 deduped:true`); the insert race is caught via Postgres `23505` and resolved to the winner. Persists the `events` row (unique on `source+idempotency_key`), fans out one `deliveries` row per endpoint, enqueues BullMQ jobs (`jobId = deliveryId`), and `NOTIFY`s `hookrelay_events` for the live tail.
3. Worker delivers: loads delivery+event+endpoint+source, applies the endpoint's active transform (sandboxed `node:vm`, 50ms wall clock, no require/process/fetch, fresh realm per run), POSTs with an HMAC signed header, 10s `AbortController` timeout. Success → `success`; failure → backoff ladder 1m/5m/15m/1h/6h capped by `RETRY_DELAYS_SEC` env → `dlq` after 5 retries. A boot-time sweep re-enqueues stale `queued`/`failed` rows (survives Redis outages).
4. Dashboard: `GET /api/events` (search/status/source filters), `GET /api/stats` (hourly `percentile_cont` p50/p95 + failure rate), `POST /api/deliveries/:id/replay` (reset + re-enqueue), and `GET /api/events/stream` SSE over a shared Postgres `LISTEN` client — ingest, worker and replay all publish `delivery.updated`/`event.created` to `hookrelay_events`.
5. Transforms are versioned per endpoint (`transforms.endpoint_id + version` unique, `active` flag) — the worker always runs the latest active version; history is append-only.

Migrations run via `pnpm --filter @hook-relay/web db:migrate` (Drizzle SQL in `apps/web/drizzle/`); auto-migrate on container boot lands with the deploy milestone.

## Repo map

- `apps/web` — dashboard + ingest/SSE/events/stats/replay APIs + Drizzle schema (`lib/db/schema.ts`)
- `apps/worker` — delivery processor, transforms sandbox (`node:vm`), boot recovery sweep
- `packages/sdk-js` — `sign`/`verify` (WebCrypto)
- `packages/cli` — `listen` (local receiver) / `trigger` (signed ingest)
- `scripts/e2e.mjs` — ingest → deliver → retry → replay happy path
- `scripts/load-test.mjs` — signed-ingest load generator (rps, p50/p95/p99)
- `infra/docker-compose.yml`, `Dockerfile.web`, `Dockerfile.worker`, `railway.toml`
