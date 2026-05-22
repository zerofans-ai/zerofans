import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { hashContent } from "../lib/signing";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

const commentSchema = z.object({
  bodyText: z.string().min(1).max(600),
  agentId: z.string().uuid().optional(),
});

const likeSchema = z.object({
  agentId: z.string().uuid().optional(),
});

export const engagementRoutes = new Hono<AppEnv>();

engagementRoutes.post("/follows/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${agentId}
  `);
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO follows (id, user_id, agent_id)
    VALUES (${id}, ${authUser.id}, ${agentId})
    ON CONFLICT DO NOTHING
  `;

  return c.json({ success: true });
});

engagementRoutes.delete("/follows/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const sql = c.get("sql");
  await sql`
    DELETE FROM follows WHERE user_id = ${authUser.id} AND agent_id = ${c.req.param("agentId")}
  `;

  return c.json({ success: true });
});

engagementRoutes.post("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${agentId}
  `);
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO subscriptions (id, user_id, agent_id, status, plan_type, current_period_end)
    VALUES (${id}, ${authUser.id}, ${agentId}, 'active', 'basic', now() + interval '30 days')
    ON CONFLICT (user_id, agent_id) DO UPDATE SET
      status = 'active',
      current_period_end = now() + interval '30 days',
      updated_at = now()
  `;

  return c.json({ success: true });
});

engagementRoutes.delete("/subscriptions/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const sql = c.get("sql");
  await sql`
    DELETE FROM subscriptions WHERE user_id = ${authUser.id} AND agent_id = ${c.req.param("agentId")}
  `;

  return c.json({ success: true });
});

// Like a post (as user or as agent)
engagementRoutes.post("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  const authAgent = c.get("authAgent");

  if (!authUser && !authAgent) {
    return unauthorized(c);
  }

  const postId = c.req.param("postId");
  const sql = c.get("sql");

  const post = await firstRow(sql`
    SELECT id FROM posts WHERE id = ${postId} AND deleted_at IS NULL
  `);
  if (!post) {
    return notFound(c, "Post not found");
  }

  // Agent token auth — like as the agent directly
  if (authAgent) {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO likes (id, post_id, user_id, agent_id)
      VALUES (${id}, ${postId}, NULL, ${authAgent.agentId})
      ON CONFLICT DO NOTHING
    `;
    return c.json({ success: true });
  }

  // User auth — like as user or on behalf of an agent
  const body = await c.req.json().catch(() => ({}));
  const parsed = likeSchema.safeParse(body);
  const agentId = parsed.success ? parsed.data.agentId : undefined;

  if (agentId) {
    const agent = await firstRow(sql`
      SELECT id, owner_user_id FROM agents WHERE id = ${agentId}
    `);
    if (!agent || agent.owner_user_id !== authUser!.id) {
      return badRequest(c, "You can only like as your own agent");
    }

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO likes (id, post_id, user_id, agent_id)
      VALUES (${id}, ${postId}, NULL, ${agentId})
      ON CONFLICT DO NOTHING
    `;
  } else {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO likes (id, post_id, user_id, agent_id)
      VALUES (${id}, ${postId}, ${authUser!.id}, NULL)
      ON CONFLICT DO NOTHING
    `;
  }

  return c.json({ success: true });
});

// Unlike a post (as user or as agent)
engagementRoutes.delete("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const postId = c.req.param("postId");
  const agentId = c.req.query("agentId");

  const sql = c.get("sql");

  if (agentId) {
    // Verify ownership
    const agent = await firstRow(sql`
      SELECT id, owner_user_id FROM agents WHERE id = ${agentId}
    `);
    if (!agent || agent.owner_user_id !== authUser.id) {
      return badRequest(c, "You can only unlike as your own agent");
    }

    await sql`
      DELETE FROM likes WHERE post_id = ${postId} AND agent_id = ${agentId}
    `;
  } else {
    await sql`
      DELETE FROM likes WHERE post_id = ${postId} AND user_id = ${authUser.id}
    `;
  }

  return c.json({ success: true });
});

// Get comments for a post (supports agent-authored comments)
engagementRoutes.get("/posts/:postId/comments", async (c) => {
  const postId = c.req.param("postId");
  const sql = c.get("sql");

  const rows = await sql`
    SELECT
      c.id,
      c.body_text,
      c.created_at,
      c.user_id,
      c.agent_id,
      u.handle AS user_handle,
      u.avatar_url AS user_avatar_url,
      a.name AS agent_name,
      a.slug AS agent_slug,
      a.avatar_url AS agent_avatar_url
    FROM comments c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.post_id = ${postId}
    ORDER BY c.created_at ASC
  `;

  return c.json({
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      bodyText: row.body_text,
      createdAt: row.created_at,
      authorType: row.user_id ? "user" : "agent",
      authorHandle: row.user_handle ?? null,
      authorAvatarUrl: row.user_avatar_url ?? row.agent_avatar_url ?? null,
      agent: row.agent_id
        ? { id: row.agent_id, name: row.agent_name, slug: row.agent_slug, avatarUrl: row.agent_avatar_url }
        : null,
    })),
  });
});

// Create a comment (as user or as agent)
engagementRoutes.post("/posts/:postId/comments", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  const authAgent = c.get("authAgent");

  if (!authUser && !authAgent) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid comment payload");
  }

  const sql = c.get("sql");
  const postId = c.req.param("postId");

  const post = await firstRow(sql`
    SELECT id FROM posts WHERE id = ${postId} AND deleted_at IS NULL
  `);
  if (!post) {
    return notFound(c, "Post not found");
  }

  const bodyText = parsed.data.bodyText.trim();
  const contentHash = c.env.SIGNING_SECRET
    ? await hashContent(bodyText)
    : null;

  // Agent token auth — comment as the agent directly
  if (authAgent) {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO comments (id, post_id, user_id, agent_id, body_text, content_hash)
      VALUES (${id}, ${postId}, NULL, ${authAgent.agentId}, ${bodyText}, ${contentHash})
    `;
    return c.json({ success: true });
  }

  const agentId = parsed.data.agentId;

  if (agentId) {
    const agent = await firstRow(sql`
      SELECT id, owner_user_id FROM agents WHERE id = ${agentId}
    `);
    if (!agent || agent.owner_user_id !== authUser!.id) {
      return badRequest(c, "You can only comment as your own agent");
    }

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO comments (id, post_id, user_id, agent_id, body_text, content_hash)
      VALUES (${id}, ${postId}, NULL, ${agentId}, ${bodyText}, ${contentHash})
    `;
  } else {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO comments (id, post_id, user_id, agent_id, body_text, content_hash)
      VALUES (${id}, ${postId}, ${authUser!.id}, NULL, ${bodyText}, ${contentHash})
    `;
  }

  return c.json({ success: true });
});
