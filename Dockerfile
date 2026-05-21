FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/ranking-wasm/package.json ./packages/ranking-wasm/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN bun run build:api

FROM base AS release
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/drizzle.config.ts ./apps/api/drizzle.config.ts

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "dist/server.js"]
