import { createMiddleware } from "hono/factory";
import { createSql } from "../db";
import type { AppEnv } from "../types/env";

export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const sql = createSql(c.env.NEON_CONNECTION_STRING);
  c.set("sql", sql);
  await next();
});
