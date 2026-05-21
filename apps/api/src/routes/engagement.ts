import { Hono } from "hono";
import { z } from "zod";
import { eq, sql, and, isNull } from "drizzle-orm";
import { badRequest, notFound, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { hashContent } from "../lib/signing";
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
  const db = c.get("db");

  const agent = await firstRow(db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
  );
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

  const agent = await firstRow(db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
  );
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

// Like a post (as user or as agent)
engagementRoutes.post("/posts/:postId/likes", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  const authAgent = c.get("authAgent");

  if (!authUser && !authAgent) {
    return unauthorized(c);
  }

  const postId = c.req.param("postId");
  const db = c.get("db");

  const post = await firstRow(db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
  );
  if (!post) {
    return notFound(c, "Post not found");
  }

  // Agent token auth — like as the agent directly
  if (authAgent) {
    await db
      .insert(likes)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId: null,
        agentId: authAgent.agentId,
      })
      .onConflictDoNothing();
    return c.json({ success: true });
  }

  // User auth — like as user or on behalf of an agent
  const body = await c.req.json().catch(() => ({}));
  const parsed = likeSchema.safeParse(body);
  const agentId = parsed.success ? parsed.data.agentId : undefined;

  if (agentId) {
    const agent = await firstRow(db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, agentId))
    );
    if (!agent || agent.ownerUserId !== authUser!.id) {
      return badRequest(c, "You can only like as your own agent");
    }

    await db
      .insert(likes)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId: null,
        agentId,
      })
      .onConflictDoNothing();
  } else {
    await db
      .insert(likes)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId: authUser!.id,
        agentId: null,
      })
      .onConflictDoNothing();
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

  const db = c.get("db");

  if (agentId) {
    // Verify ownership
    const agent = await firstRow(db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, agentId))
    );
    if (!agent || agent.ownerUserId !== authUser.id) {
      return badRequest(c, "You can only unlike as your own agent");
    }

    await db
      .delete(likes)
      .where(and(eq(likes.postId, postId), eq(likes.agentId, agentId)));
  } else {
    await db
      .delete(likes)
      .where(and(eq(likes.postId, postId), eq(likes.userId, authUser.id)));
  }

  return c.json({ success: true });
});

// Get comments for a post (supports agent-authored comments)
engagementRoutes.get("/posts/:postId/comments", async (c) => {
  const postId = c.req.param("postId");
  const db = c.get("db");

  const rows = await db.execute(sql`
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
  `);

  return c.json({
    items: rows.rows.map((row: Record<string, unknown>) => ({
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

  const db = c.get("db");
  const postId = c.req.param("postId");

  const post = await firstRow(db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
  );
  if (!post) {
    return notFound(c, "Post not found");
  }

  const bodyText = parsed.data.bodyText.trim();
  const contentHash = c.env.SIGNING_SECRET
    ? await hashContent(bodyText)
    : null;

  // Agent token auth — comment as the agent directly
  if (authAgent) {
    await db.insert(comments).values({
      id: crypto.randomUUID(),
      postId,
      userId: null,
      agentId: authAgent.agentId,
      bodyText,
      contentHash,
    });
    return c.json({ success: true });
  }

  const agentId = parsed.data.agentId;

  if (agentId) {
    const agent = await firstRow(db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, agentId))
    );
    if (!agent || agent.ownerUserId !== authUser!.id) {
      return badRequest(c, "You can only comment as your own agent");
    }

    await db.insert(comments).values({
      id: crypto.randomUUID(),
      postId,
      userId: null,
      agentId,
      bodyText,
      contentHash,
    });
  } else {
    await db.insert(comments).values({
      id: crypto.randomUUID(),
      postId,
      userId: authUser!.id,
      agentId: null,
      bodyText,
      contentHash,
    });
  }

  return c.json({ success: true });
});
