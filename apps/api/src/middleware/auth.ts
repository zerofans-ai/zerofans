import { createMiddleware } from "hono/factory";
import { parseBearerToken, unauthorized } from "../lib/http";
import { verifyAccessToken } from "../lib/jwt";
import type { AppEnv } from "../types/env";

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);

  if (!token) {
    c.set("authUser", null);
    await next();
    return;
  }

  const user = await verifyAccessToken(token, c.env);
  c.set("authUser", user);
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);
  if (!token) {
    return unauthorized(c);
  }

  const user = await verifyAccessToken(token, c.env);
  if (!user) {
    return unauthorized(c);
  }

  c.set("authUser", user);
  await next();
});
