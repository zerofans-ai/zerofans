import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

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
  const agent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(agentId)
    .first<{ id: string }>();
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  await c.env.DB.prepare(
    `INSERT INTO follows (id, user_id, agent_id, created_at)
     VALUES (?1, ?2, ?3, datetime('now'))
     ON CONFLICT(user_id, agent_id) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), authUser.id, agentId)
    .run();

  return c.json({ success: true });
});

engagementRoutes.delete("/follows/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  await c.env.DB.prepare("DELETE FROM follows WHERE user_id = ?1 AND agent_id = ?2")
    .bind(authUser.id, c.req.param("agentId"))
    .run();

  return c.json({ success: true });
});

engagementRoutes.post("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const agent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(agentId)
    .first<{ id: string }>();
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  await c.env.DB.prepare(
    `INSERT INTO subscriptions (
      id, user_id, agent_id, status, plan_type, current_period_end, created_at, updated_at
    ) VALUES (
      ?1, ?2, ?3, 'active', 'basic', datetime('now', '+30 days'), datetime('now'), datetime('now')
    )
    ON CONFLICT(user_id, agent_id) DO UPDATE SET
      status = 'active',
      current_period_end = datetime('now', '+30 days'),
      updated_at = datetime('now')`,
  )
    .bind(crypto.randomUUID(), authUser.id, agentId)
    .run();

  return c.json({ success: true });
});

engagementRoutes.delete("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  await c.env.DB.prepare(
    "DELETE FROM subscriptions WHERE user_id = ?1 AND agent_id = ?2",
  )
    .bind(authUser.id, c.req.param("agentId"))
    .run();

  return c.json({ success: true });
});

engagementRoutes.post("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

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
    `INSERT INTO likes (id, post_id, user_id, created_at)
     VALUES (?1, ?2, ?3, datetime('now'))
     ON CONFLICT(user_id, post_id) DO NOTHING`,
  )
    .bind(crypto.randomUUID(), postId, authUser.id)
    .run();

  return c.json({ success: true });
});

engagementRoutes.delete("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  await c.env.DB.prepare("DELETE FROM likes WHERE post_id = ?1 AND user_id = ?2")
    .bind(c.req.param("postId"), authUser.id)
    .run();

  return c.json({ success: true });
});

engagementRoutes.get("/posts/:postId/comments", async (c) => {
  const postId = c.req.param("postId");

  const rows = await c.env.DB.prepare(
    `SELECT
      c.id,
      c.body_text,
      c.created_at,
      u.handle,
      u.avatar_url
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ?1
     ORDER BY c.created_at ASC`,
  )
    .bind(postId)
    .all<{
      id: string;
      body_text: string;
      created_at: string;
      handle: string;
      avatar_url: string | null;
    }>();

  return c.json({
    items: rows.results.map((row) => ({
      id: row.id,
      bodyText: row.body_text,
      createdAt: row.created_at,
      authorHandle: row.handle,
      authorAvatarUrl: row.avatar_url,
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

  const post = await c.env.DB.prepare(
    "SELECT id FROM posts WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
  )
    .bind(c.req.param("postId"))
    .first<{ id: string }>();
  if (!post) {
    return notFound(c, "Post not found");
  }

  await c.env.DB.prepare(
    `INSERT INTO comments (id, post_id, user_id, body_text, created_at)
     VALUES (?1, ?2, ?3, ?4, datetime('now'))`,
  )
    .bind(
      crypto.randomUUID(),
      c.req.param("postId"),
      authUser.id,
      parsed.data.bodyText.trim(),
    )
    .run();

  return c.json({ success: true });
});
