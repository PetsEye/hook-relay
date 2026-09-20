# ARCHITECTURE — hook-relay (Railway all-in-one)

## Services (Railway)

| Service | Source | Health | Env |
|---|---|---|---|
| web | `Dockerfile.web` (Next standalone) | `/api/health` | `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` |
| worker | `Dockerfile.worker` (Node) | process liveness | `DATABASE_URL`, `REDIS_URL` |
| postgres | Railway plugin | — | `DATABASE_URL` |
| redis | Railway plugin | — | `REDIS_URL` |

Local mirror: `infra/docker-compose.yml` (postgres:16, redis:7, web:3000, worker).

## Request flow (steps 1–2 live, 3–4 next)

1. `POST /api/ingest/:sourceId` looks up the source (404), rate-limits per source (Redis fixed window, fail-open → 429), reads the raw body (413 over `MAX_PAYLOAD_BYTES`), verifies `x-hookrelay-signature` (HMAC-SHA256 via `hookrelay-js` → 401), parses JSON (400).
2. Dedupes by `Idempotency-Key` — repeat requests return the original receipt (`200 deduped:true`); the insert race is caught via Postgres `23505` and resolved to the winner. Persists the `events` row (unique on `source+idempotency_key`), fans out one `deliveries` row per endpoint, enqueues BullMQ jobs (`jobId = deliveryId`).
3. (Next) Worker delivers with 10s timeout, exponential backoff (1m, 5m, 15m, 1h, 6h), max 5 attempts → `failed` → DLQ; dashboard replays from DLQ.
4. (Next) Dashboard subscribes via `GET /api/events/stream` (SSE) for live tail.

Migrations run via `pnpm --filter @hook-relay/web db:migrate` (Drizzle SQL in `apps/web/drizzle/`); auto-migrate on container boot lands with the worker milestone.

## Repo map

- `apps/web` — dashboard + ingest/SSE APIs + Drizzle schema (`lib/db/schema.ts`)
- `apps/worker` — BullMQ processors
- `packages/sdk-js` — `sign`/`verify` (WebCrypto)
- `packages/cli` — `listen`/`trigger` (milestone 5)
- `infra/docker-compose.yml`, `Dockerfile.web`, `Dockerfile.worker`, `railway.toml`
