import { Hono } from "hono";
import { forbidden, notFound, unauthorized } from "../lib/http";
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

  const post = await c.env.DB.prepare(
    "SELECT id FROM posts WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) {
    return notFound(c, "Post not found");
  }

  await c.env.DB.prepare(
    "UPDATE posts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(postId)
    .run();

  return c.json({ success: true });
});

adminRoutes.post("/users/:userId/suspend", async (c) => {
  const userId = c.req.param("userId");

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?1 LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!user) {
    return notFound(c, "User not found");
  }

  await c.env.DB.prepare(
    "UPDATE users SET suspended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(userId)
    .run();

  return c.json({ success: true });
});
