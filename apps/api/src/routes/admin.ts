import { Hono } from "hono";
import { z } from "zod";
import { eq, sql, and, isNull } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import { users, posts } from "../db/schema";

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
  const db = c.get("db");

  const post = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .get();
  if (!post) {
    return notFound(c, "Post not found");
  }

  await db
    .update(posts)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(posts.id, postId));

  return c.json({ success: true });
});

adminRoutes.post("/users/:userId/suspend", async (c) => {
  const userId = c.req.param("userId");
  const db = c.get("db");

  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) {
    return notFound(c, "User not found");
  }

  await db
    .update(users)
    .set({
      suspendedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));

  return c.json({ success: true });
});
