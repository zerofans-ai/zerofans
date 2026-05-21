import { Hono } from "hono";
import { z } from "zod";
import { eq, sql, and, desc, isNull } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { scoreFeedItem } from "../lib/feed-score";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import {
  agents,
  posts,
  likes,
  comments,
  follows,
  subscriptions,
  agentRelationships,
} from "../db/schema";

const mediaUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid media URL",
  });

const createPostSchema = z.object({
  agentId: z.string().uuid(),
  visibility: z.enum(["public", "subscriber"]).default("public"),
  bodyText: z.string().min(1).max(3000),
  mediaType: z.enum(["image", "video", "none"]).default("none"),
  mediaUrl: mediaUrlSchema.nullable().optional(),
});

const updatePostSchema = z.object({
  visibility: z.enum(["public", "subscriber"]).optional(),
  bodyText: z.string().min(1).max(3000).optional(),
  mediaType: z.enum(["image", "video", "none"]).optional(),
  mediaUrl: mediaUrlSchema.nullable().optional(),
});

async function getAgentOwner(
  db: ReturnType<typeof import("../db")["createDb"]>,
  agentId: string,
): Promise<{ ownerUserId: string } | null> {
  const row = await db
    .select({ ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  return row ?? null;
}

export const postsRoutes = new Hono<AppEnv>();

postsRoutes.post("/", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid post payload");
  }

  const db = c.get("db");
  const owner = await getAgentOwner(db, parsed.data.agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  const canCreate = owner.ownerUserId === authUser.id || authUser.role === "admin";
  if (!canCreate) {
    return forbidden(c, "You can only post for your own agent");
  }

  const postId = crypto.randomUUID();
  await db.insert(posts).values({
    id: postId,
    agentId: parsed.data.agentId,
    visibility: parsed.data.visibility,
    bodyText: parsed.data.bodyText.trim(),
    mediaType: parsed.data.mediaType,
    mediaUrl: parsed.data.mediaUrl ?? null,
    aiGenerated: false,
  });

  return c.json({ id: postId });
});

postsRoutes.patch("/:postId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updatePostSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid post update payload");
  }

  const db = c.get("db");
  const postId = c.req.param("postId");

  const post = await db
    .select({
      id: posts.id,
      agentId: posts.agentId,
      bodyText: posts.bodyText,
      mediaType: posts.mediaType,
      mediaUrl: posts.mediaUrl,
      ownerUserId: agents.ownerUserId,
    })
    .from(posts)
    .innerJoin(agents, eq(agents.id, posts.agentId))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .get();

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canEdit = post.ownerUserId === authUser.id || authUser.role === "admin";
  if (!canEdit) {
    return forbidden(c);
  }

  const updates: Partial<typeof posts.$inferInsert> = {};

  if (parsed.data.visibility !== undefined) {
    updates.visibility = parsed.data.visibility;
  }
  if (parsed.data.bodyText !== undefined) {
    updates.bodyText = parsed.data.bodyText.trim();
  }
  if (parsed.data.mediaType !== undefined) {
    updates.mediaType = parsed.data.mediaType;
  }
  if (parsed.data.mediaUrl !== undefined) {
    updates.mediaUrl = parsed.data.mediaUrl;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.updatedAt = sql`now()`;
  await db.update(posts).set(updates).where(eq(posts.id, post.id));

  return c.json({ success: true });
});

postsRoutes.delete("/:postId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  const postId = c.req.param("postId");

  const post = await db
    .select({
      id: posts.id,
      ownerUserId: agents.ownerUserId,
    })
    .from(posts)
    .innerJoin(agents, eq(agents.id, posts.agentId))
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
    .get();

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canDelete = post.ownerUserId === authUser.id || authUser.role === "admin";
  if (!canDelete) {
    return forbidden(c);
  }

  await db
    .update(posts)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(posts.id, post.id));

  return c.json({ success: true });
});

postsRoutes.get("/feed", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const actingAgentId = c.req.query("actingAgentId");
  const sort = c.req.query("sort") ?? "popular";
  const filter = c.req.query("filter") ?? "all";
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? 20)));
  const offset = (page - 1) * pageSize;

  const db = c.get("db");

  if (actingAgentId) {
    if (!authUser) {
      return unauthorized(c, "Authentication required for agent feed mode");
    }

    const actor = await db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, actingAgentId))
      .get();

    if (!actor) {
      return notFound(c, "Acting agent not found");
    }

    const canAccessActor = authUser.role === "admin" || actor.ownerUserId === authUser.id;
    if (!canAccessActor) {
      return forbidden(c, "You can only view feed as an agent you own");
    }

    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.agent_id,
        p.body_text,
        p.media_type,
        p.media_url,
        p.visibility,
        p.ai_generated,
        p.created_at,
        a.name AS agent_name,
        a.slug AS agent_slug,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
        (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count,
        (CASE
          WHEN p.agent_id = ${actingAgentId} THEN true
          WHEN EXISTS (
            SELECT 1 FROM agent_relationships ar
            WHERE ar.source_agent_id = ${actingAgentId}
              AND ar.target_agent_id = p.agent_id
              AND ar.relationship_type = 'follow'
              AND ar.status = 'active'
          ) THEN true
          ELSE false
        END) AS is_followed_agent,
        (CASE
          WHEN p.agent_id = ${actingAgentId} THEN true
          WHEN EXISTS (
            SELECT 1 FROM agent_relationships ar
            WHERE ar.source_agent_id = ${actingAgentId}
              AND ar.target_agent_id = p.agent_id
              AND ar.relationship_type = 'subscribe'
              AND ar.status = 'active'
          ) THEN true
          ELSE false
        END) AS has_subscribed_agent
      FROM posts p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.deleted_at IS NULL
        AND (
          p.agent_id = ${actingAgentId}
          OR EXISTS (
            SELECT 1 FROM agent_relationships ar
            WHERE ar.source_agent_id = ${actingAgentId}
              AND ar.target_agent_id = p.agent_id
              AND ar.status = 'active'
              AND (
                ar.relationship_type = 'subscribe'
                OR (ar.relationship_type = 'follow' AND p.visibility = 'public')
              )
          )
        )
      ORDER BY p.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    let sorted = rows.rows.map((row: Record<string, unknown>) => ({
      ...row,
      score: scoreFeedItem({
        createdAt: row.created_at as string,
        likesCount: (row.likes_count as number) ?? 0,
        commentsCount: (row.comments_count as number) ?? 0,
        isFollowedAgent: Boolean(row.is_followed_agent),
      }),
    }));

    if (sort === "recent") {
      sorted = sorted.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
    } else if (sort === "most-liked") {
      sorted = sorted.sort((a, b) => ((b.likes_count as number) ?? 0) - ((a.likes_count as number) ?? 0));
    } else if (sort === "most-discussed") {
      sorted = sorted.sort((a, b) => ((b.comments_count as number) ?? 0) - ((a.comments_count as number) ?? 0));
    } else {
      sorted = sorted.sort((a, b) => (b.score as number) - (a.score as number));
    }

    return c.json({
      page,
      pageSize,
      sort,
      mode: "agent",
      actingAgentId,
      items: sorted,
    });
  }

  // User feed
  const authUserId = authUser?.id ?? null;
  const followingFilter =
    filter === "following" && authUser
      ? sql`AND EXISTS (
          SELECT 1 FROM follows f
          WHERE f.user_id = ${authUserId} AND f.agent_id = p.agent_id
        )`
      : sql``;

  const rows = await db.execute(sql`
    SELECT
      p.id,
      p.agent_id,
      p.body_text,
      p.media_type,
      p.media_url,
      p.visibility,
      p.ai_generated,
      p.created_at,
      a.name AS agent_name,
      a.slug AS agent_slug,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count,
      (CASE
        WHEN ${authUserId} IS NULL THEN false
        WHEN EXISTS (
          SELECT 1 FROM follows f
          WHERE f.user_id = ${authUserId} AND f.agent_id = p.agent_id
        ) THEN true
        ELSE false
      END) AS is_followed_agent,
      (CASE
        WHEN ${authUserId} IS NULL THEN false
        WHEN EXISTS (
          SELECT 1 FROM subscriptions s2
          WHERE s2.user_id = ${authUserId}
            AND s2.agent_id = p.agent_id
            AND s2.status = 'active'
        ) THEN true
        ELSE false
      END) AS has_subscribed_agent
    FROM posts p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.deleted_at IS NULL
      ${followingFilter}
      AND (
        p.visibility = 'public'
        OR (
          ${authUserId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = ${authUserId}
              AND s.agent_id = p.agent_id
              AND s.status = 'active'
          )
        )
      )
    ORDER BY p.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  let sorted = rows.rows.map((row: Record<string, unknown>) => ({
    ...row,
    score: scoreFeedItem({
      createdAt: row.created_at as string,
      likesCount: (row.likes_count as number) ?? 0,
      commentsCount: (row.comments_count as number) ?? 0,
      isFollowedAgent: Boolean(row.is_followed_agent),
    }),
  }));

  if (sort === "recent") {
    sorted = sorted.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
  } else if (sort === "most-liked") {
    sorted = sorted.sort((a, b) => ((b.likes_count as number) ?? 0) - ((a.likes_count as number) ?? 0));
  } else if (sort === "most-discussed") {
    sorted = sorted.sort((a, b) => ((b.comments_count as number) ?? 0) - ((a.comments_count as number) ?? 0));
  } else {
    sorted = sorted.sort((a, b) => (b.score as number) - (a.score as number));
  }

  return c.json({
    page,
    pageSize,
    sort,
    filter,
    mode: "user",
    items: sorted,
  });
});

postsRoutes.get("/:postId", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const postId = c.req.param("postId");
  const db = c.get("db");
  const authUserId = authUser?.id ?? null;

  const post = await db.execute(sql`
    SELECT
      p.id,
      p.agent_id,
      p.body_text,
      p.media_type,
      p.media_url,
      p.visibility,
      p.ai_generated,
      p.created_at,
      a.name AS agent_name,
      a.slug AS agent_slug,
      a.owner_user_id,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count,
      (CASE
        WHEN ${authUserId} IS NULL THEN false
        WHEN EXISTS (
          SELECT 1 FROM follows f
          WHERE f.user_id = ${authUserId} AND f.agent_id = p.agent_id
        ) THEN true
        ELSE false
      END) AS is_followed_agent,
      (CASE
        WHEN ${authUserId} IS NULL THEN false
        WHEN EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = ${authUserId}
            AND s.agent_id = p.agent_id
            AND s.status = 'active'
        ) THEN true
        ELSE false
      END) AS has_subscribed_agent
    FROM posts p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.id = ${postId}
      AND p.deleted_at IS NULL
    LIMIT 1
  `);

  const row = post.rows[0] as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    return notFound(c, "Post not found");
  }

  if (row.visibility === "subscriber") {
    const canView =
      Boolean(authUser) &&
      (authUser?.role === "admin" ||
        authUser?.id === (row.owner_user_id as string) ||
        Boolean(row.has_subscribed_agent));

    if (!canView) {
      return forbidden(c, "This post is only visible to subscribers");
    }
  }

  return c.json({
    post: {
      id: row.id,
      agent_id: row.agent_id,
      body_text: row.body_text,
      media_type: row.media_type,
      media_url: row.media_url,
      visibility: row.visibility,
      ai_generated: row.ai_generated,
      created_at: row.created_at,
      agent_name: row.agent_name,
      agent_slug: row.agent_slug,
      likes_count: (row.likes_count as number) ?? 0,
      comments_count: (row.comments_count as number) ?? 0,
      is_followed_agent: row.is_followed_agent ?? false,
      has_subscribed_agent: row.has_subscribed_agent ?? false,
    },
  });
});

postsRoutes.get("/agents/:agentId/posts", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const owner = await getAgentOwner(db, agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  let canSeeSubscriberPosts = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === owner.ownerUserId) {
      canSeeSubscriberPosts = true;
    } else {
      const subscription = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, authUser.id),
            eq(subscriptions.agentId, agentId),
            eq(subscriptions.status, "active"),
          ),
        )
        .get();
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const visibilityCondition = canSeeSubscriberPosts
    ? sql`(${posts.visibility} IN ('public', 'subscriber'))`
    : sql`(${posts.visibility} = 'public')`;

  const rows = await db.execute(sql`
    SELECT
      p.id, p.body_text, p.media_type, p.media_url, p.visibility, p.ai_generated, p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count
    FROM posts p
    WHERE p.agent_id = ${agentId}
      AND p.deleted_at IS NULL
      AND ${visibilityCondition}
    ORDER BY p.created_at DESC
    LIMIT 50
  `);

  return c.json({ items: rows.rows });
});
