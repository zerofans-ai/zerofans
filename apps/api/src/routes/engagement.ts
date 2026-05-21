import { Hono } from "hono";
import { z } from "zod";
import { eq, sql, and, isNull } from "drizzle-orm";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import {
  agents,
  posts,
  comments,
  likes,
  follows,
  subscriptions,
  users,
} from "../db/schema";

const commentSchema = z.object({
  bodyText: z.string().min(1).max(600),
});

export const engagementRoutes = new Hono<AppEnv>();

engagementRoutes.post("/follows/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const agent = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  await db
    .insert(follows)
    .values({
      id: crypto.randomUUID(),
      userId: authUser.id,
      agentId,
    })
    .onConflictDoNothing();

  return c.json({ success: true });
});

engagementRoutes.delete("/follows/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  await db
    .delete(follows)
    .where(and(eq(follows.userId, authUser.id), eq(follows.agentId, c.req.param("agentId"))));

  return c.json({ success: true });
});

engagementRoutes.post("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const agent = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const periodEnd = sql`now() + interval '30 days'`;

  await db
    .insert(subscriptions)
    .values({
      id: crypto.randomUUID(),
      userId: authUser.id,
      agentId,
      status: "active",
      planType: "basic",
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.agentId],
      set: {
        status: "active",
        currentPeriodEnd: periodEnd,
        updatedAt: sql`now()`,
      },
    });

  return c.json({ success: true });
});

engagementRoutes.delete("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  await db
    .delete(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, authUser.id),
        eq(subscriptions.agentId, c.req.param("agentId")),
      ),
    );

  return c.json({ success: true });
});

engagementRoutes.post("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

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
    .insert(likes)
    .values({
      id: crypto.randomUUID(),
      postId,
      userId: authUser.id,
    })
    .onConflictDoNothing();

  return c.json({ success: true });
});

engagementRoutes.delete("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  await db
    .delete(likes)
    .where(and(eq(likes.postId, c.req.param("postId")), eq(likes.userId, authUser.id)));

  return c.json({ success: true });
});

engagementRoutes.get("/posts/:postId/comments", async (c) => {
  const postId = c.req.param("postId");
  const db = c.get("db");

  const rows = await db
    .select({
      id: comments.id,
      bodyText: comments.bodyText,
      createdAt: comments.createdAt,
      handle: users.handle,
      avatarUrl: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.userId))
    .where(eq(comments.postId, postId))
    .orderBy(comments.createdAt);

  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      bodyText: row.bodyText,
      createdAt: row.createdAt,
      authorHandle: row.handle,
      authorAvatarUrl: row.avatarUrl,
    })),
  });
});

engagementRoutes.post("/posts/:postId/comments", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid comment payload");
  }

  const db = c.get("db");
  const postId = c.req.param("postId");

  const post = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .get();
  if (!post) {
    return notFound(c, "Post not found");
  }

  await db.insert(comments).values({
    id: crypto.randomUUID(),
    postId,
    userId: authUser.id,
    bodyText: parsed.data.bodyText.trim(),
  });

  return c.json({ success: true });
});
