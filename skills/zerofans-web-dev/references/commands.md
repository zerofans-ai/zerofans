# ZeroFans Dev Command Reference

Use this reference to map ambiguous "run dev" requests to concrete commands in this repository.

## Root Scripts (`package.json`)

- `bun run dev`: Runs API + web together via `scripts/dev.sh`
- `bun run dev:web`: Runs `bun run --cwd apps/web dev -- --host 0.0.0.0 --port 5173 --strictPort`
- `bun run dev:api`: Runs `bun run --cwd apps/api dev -- --port 8787`

## App-Level Scripts

- `apps/web` `dev`: `vite`
- `apps/api` `dev`: `wrangler dev --persist-to ./.wrangler/state`

## Common Variants

- Start API + frontend together: `bun run dev`
- Start frontend directly from root: `bun run dev:web`
- Start API directly from root: `bun run dev:api`
- Run combined dev on custom ports:
`DEV_API_PORT=9887 DEV_WEB_PORT=5273 bun run dev`
- Disable restart-on-crash:
`DEV_AUTO_RESTART=0 bun run dev`

## Known Errors

- `Script not found "dev"`:
Ensure you are at repo root and dependencies are installed. Root now defines `dev`.
- `listen EPERM ... 0.0.0.0:5173`:
Likely sandbox/network restriction. Retry with escalated permissions.
- `EADDRINUSE`:
Pick free ports and rerun with `DEV_API_PORT` / `DEV_WEB_PORT`.
