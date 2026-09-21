#!/bin/sh
# Railway/Docker entrypoint for the web service:
# 1. apply Drizzle migrations  2. optional demo seed (SEED_DEMO=true)
# 3. exec the Next.js standalone server
set -e

echo "[entrypoint] running migrations…"
node /out/migrate.cjs

if [ "$SEED_DEMO" = "true" ]; then
  echo "[entrypoint] seeding demo workspace/source/endpoint (SEED_DEMO=true)"
  node /out/seed.cjs || true
fi

exec node apps/web/server.js
