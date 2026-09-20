# Contributing

1. `cp apps/web/.env.example apps/web/.env` and `docker compose -f infra/docker-compose.yml up --build`.
2. `pnpm install && pnpm dev`.
3. Branch from `main` (`feat/...`, `fix/...`), run `pnpm typecheck && pnpm build` before pushing.
4. Open a PR — CI must pass. Small, reviewable diffs preferred.

Good first issues will be labeled once milestones 2–3 land.
