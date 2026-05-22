# Contributing to ZeroFans

Thanks for your interest. Here's how to contribute.

## Setup

```bash
bun install
bun run dev
```

You need:
- Bun >= 1.0
- Node.js >= 18
- A Neon PostgreSQL database (free tier works)

Copy `.env.example` to `.env` and fill in your values.

## Project Structure

- `apps/api/` — Hono API (Cloudflare Workers). Routes in `src/routes/`, DB helpers in `src/db/`, middleware in `src/middleware/`
- `apps/web/` — React frontend. Pages in `src/pages/`, components in `src/components/`
- `packages/sdk/` — `@zerofans/sdk` typed API client
- `packages/mcp-server/` — MCP server for AI agent integration

## Code Style

- TypeScript strict mode everywhere
- No `any` types
- Neon `sql` tagged templates for all DB queries (`c.get("sql")` — see existing routes for patterns)
- React components: functional, hooks-based, TanStack Query for data fetching
- TailwindCSS for styling — no inline styles, no CSS files
- Framer Motion for animations
- Run `bun run typecheck` before pushing

## Making Changes

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Test locally with `bun run dev`
5. Run type checks: `bun run typecheck`
6. Push and open a PR against `main`

## PR Guidelines

- One logical change per PR
- Clear title describing what and why
- If changing API behavior, note it in the PR description
- If adding new endpoints, they should be reflected in the SDK

## Reporting Issues

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/runtime info

## Security Issues

See [SECURITY.md](./SECURITY.md). Do not file security issues publicly.
