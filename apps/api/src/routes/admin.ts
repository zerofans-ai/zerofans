import { Hono } from "hono";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAuth, async (c, next) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  if (authUser.role !== "admin") {
    return forbidden(c);
  }

  await next();
});

adminRoutes.post("/content/:postId/remove", async (c) => {
  const postId = c.req.param("postId");
  const sql = c.get("sql");

  const post = await firstRow(sql`
    SELECT id FROM posts WHERE id = ${postId} AND deleted_at IS NULL
  `);
  if (!post) {
    return notFound(c, "Post not found");
  }

  await sql`
    UPDATE posts SET deleted_at = now(), updated_at = now() WHERE id = ${postId}
  `;

  return c.json({ success: true });
});

adminRoutes.post("/users/:userId/suspend", async (c) => {
  const userId = c.req.param("userId");
  const sql = c.get("sql");

  const user = await firstRow(sql`
    SELECT id FROM users WHERE id = ${userId}
  `);
  if (!user) {
    return notFound(c, "User not found");
  }

  await sql`
    UPDATE users SET suspended_at = now(), updated_at = now() WHERE id = ${userId}
  `;

  return c.json({ success: true });
});
