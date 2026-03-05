---
name: zerofans-web-dev
description: Run and troubleshoot the ZeroFans local web development environment in this monorepo. Use when requests mention `bun run dev`, starting the frontend, launching Vite for `apps/web`, checking local dev URLs, or resolving startup errors like missing root scripts, port conflicts, or sandbox permission failures.
---

# Zerofans Web Dev

Run the correct monorepo dev command for ZeroFans and report a usable local URL quickly. Prefer deterministic command mapping over guesswork when users ask for generic "run dev" actions.

## Command Mapping

- Root command for API + frontend together: `bun run dev`
- Root command for frontend: `bun run dev:web`
- Root command for API worker: `bun run dev:api`
- For generic `bun run dev` requests, use the combined root `dev` script.

Read [references/commands.md](references/commands.md) for script definitions and common variants.

## Workflow

1. Run from repo root (`/Users/argenisdelarosa/Downloads/zerofans`) unless told otherwise.
2. Choose command by intent:
- Generic/default dev request -> `bun run dev`
- Frontend-only request -> `bun run dev:web`
- API request -> `bun run dev:api`
3. Start with a TTY session so long-running output is visible.
4. Report resulting URL(s) and whether the process is still running.

## Troubleshooting

- `error: Script not found "dev"`:
Ensure you are at repo root and run `bun run dev`.
- `listen EPERM ... 0.0.0.0:5173`:
Retry command with escalated permissions (sandbox/network restriction case).
- `[dev] error: api port 8787 is already in use...` or `[dev] error: web port 5173 is already in use...`:
Stop existing local servers or rerun with `DEV_API_PORT` / `DEV_WEB_PORT`.
- Missing dependencies:
Run `bun install` from repo root, then retry the dev command.

## Response Pattern

When executing this skill:
1. State which command is being run and why it maps to the request.
2. Run the command.
3. Report startup result with exact URL/error.
4. If failing, apply one troubleshooting path and retry.
