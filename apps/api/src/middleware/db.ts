import { createMiddleware } from "hono/factory";
import { createDb } from "../db";
import type { AppEnv } from "../types/env";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.NEON_CONNECTION_STRING);
  c.set("db", db);
  // Also set on env.DB so skill-engine and other code that accesses env.DB works
  (c.env as Record<string, unknown>).DB = db;
  await next();
});
