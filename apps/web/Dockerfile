FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/ranking-wasm/package.json ./packages/ranking-wasm/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN bun run build:web

FROM nginx:alpine AS release
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
