# ARCHITECTURE — hook-relay (Railway all-in-one)

## Services (Railway)

| Service | Source | Health | Env |
|---|---|---|---|
| web | `Dockerfile.web` (Next standalone) | `/api/health` | `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` |
| worker | `Dockerfile.worker` (Node) | process liveness | `DATABASE_URL`, `REDIS_URL` |
| postgres | Railway plugin | — | `DATABASE_URL` |
| redis | Railway plugin | — | `REDIS_URL` |

Local mirror: `infra/docker-compose.yml` (postgres:16, redis:7, web:3000, worker).

## Request flow

1. `POST /api/ingest/:sourceId` validates JSON (Zod), checks `Idempotency-Key`, verifies `x-hookrelay-signature` (HMAC-SHA256 via `hookrelay-js`), rate-limits per source (Redis fixed window).
2. Persists `events` row (unique on `source+idempotency_key`), fans out one `deliveries` row per endpoint, enqueues BullMQ jobs.
3. Worker delivers with 10s timeout, exponential backoff (1m, 5m, 15m, 1h, 6h), max 5 attempts → `failed` → DLQ; dashboard replays from DLQ.
4. Dashboard subscribes via `GET /api/events/stream` (SSE) for live tail.

## Repo map

- `apps/web` — dashboard + ingest/SSE APIs + Drizzle schema (`lib/db/schema.ts`)
- `apps/worker` — BullMQ processors
- `packages/sdk-js` — `sign`/`verify` (WebCrypto)
- `packages/cli` — `listen`/`trigger` (milestone 5)
- `infra/docker-compose.yml`, `Dockerfile.web`, `Dockerfile.worker`, `railway.toml`
