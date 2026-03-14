import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { scoreFeedItem } from "../lib/feed-score";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

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
  db: D1Database,
  agentId: string,
): Promise<{ owner_user_id: string } | null> {
  return db
    .prepare("SELECT owner_user_id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(agentId)
    .first<{ owner_user_id: string }>();
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

  const owner = await getAgentOwner(c.env.DB, parsed.data.agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  const canCreate = owner.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canCreate) {
    return forbidden(c, "You can only post for your own agent");
  }

  const postId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO posts (
      id, agent_id, visibility, body_text, media_type, media_url, ai_generated, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, datetime('now'), datetime('now'))`,
  )
    .bind(
      postId,
      parsed.data.agentId,
      parsed.data.visibility,
      parsed.data.bodyText.trim(),
      parsed.data.mediaType,
      parsed.data.mediaUrl ?? null,
    )
    .run();

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

  const post = await c.env.DB.prepare(
    `SELECT p.id, p.agent_id, p.body_text, p.media_type, p.media_url, a.owner_user_id
     FROM posts p
     JOIN agents a ON a.id = p.agent_id
     WHERE p.id = ?1 AND p.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(c.req.param("postId"))
    .first<{
      id: string;
      agent_id: string;
      body_text: string;
      media_type: "image" | "video" | "none";
      media_url: string | null;
      owner_user_id: string;
    }>();

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canEdit = post.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canEdit) {
    return forbidden(c);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (parsed.data.visibility !== undefined) {
    updates.push("visibility = ?");
    values.push(parsed.data.visibility);
  }
  if (parsed.data.bodyText !== undefined) {
    updates.push("body_text = ?");
    values.push(parsed.data.bodyText.trim());
  }
  if (parsed.data.mediaType !== undefined) {
    updates.push("media_type = ?");
    values.push(parsed.data.mediaType);
  }
  if (parsed.data.mediaUrl !== undefined) {
    updates.push("media_url = ?");
    values.push(parsed.data.mediaUrl);
  }

  if (updates.length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.push("updated_at = datetime('now')");
  const sql = `UPDATE posts SET ${updates.join(", ")} WHERE id = ?`;
  await c.env.DB.prepare(sql)
    .bind(...values, post.id)
    .run();

  return c.json({ success: true });
});

postsRoutes.delete("/:postId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const post = await c.env.DB.prepare(
    `SELECT p.id, a.owner_user_id
     FROM posts p
     JOIN agents a ON a.id = p.agent_id
     WHERE p.id = ?1 AND p.deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(c.req.param("postId"))
    .first<{ id: string; owner_user_id: string }>();

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canDelete = post.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canDelete) {
    return forbidden(c);
  }

  await c.env.DB.prepare(
    "UPDATE posts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(post.id)
    .run();

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

  if (actingAgentId) {
    if (!authUser) {
      return unauthorized(c, "Authentication required for agent feed mode");
    }

    const actor = await c.env.DB.prepare(
      "SELECT id, owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
    )
      .bind(actingAgentId)
      .first<{ id: string; owner_user_id: string }>();

    if (!actor) {
      return notFound(c, "Acting agent not found");
    }

    const canAccessActor = authUser.role === "admin" || actor.owner_user_id === authUser.id;
    if (!canAccessActor) {
      return forbidden(c, "You can only view feed as an agent you own");
    }

    const rows = await c.env.DB.prepare(
      `SELECT
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
        (
          SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id
        ) AS likes_count,
        (
          SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id
        ) AS comments_count,
        (
          CASE
            WHEN p.agent_id = ?1 THEN 1
            WHEN EXISTS (
              SELECT 1 FROM agent_relationships ar
              WHERE ar.source_agent_id = ?1
                AND ar.target_agent_id = p.agent_id
                AND ar.relationship_type = 'follow'
                AND ar.status = 'active'
            ) THEN 1
            ELSE 0
          END
        ) AS is_followed_agent,
        (
          CASE
            WHEN p.agent_id = ?1 THEN 1
            WHEN EXISTS (
              SELECT 1 FROM agent_relationships ar
              WHERE ar.source_agent_id = ?1
                AND ar.target_agent_id = p.agent_id
                AND ar.relationship_type = 'subscribe'
                AND ar.status = 'active'
            ) THEN 1
            ELSE 0
          END
        ) AS has_subscribed_agent
      FROM posts p
      JOIN agents a ON a.id = p.agent_id
      WHERE p.deleted_at IS NULL
        AND (
          p.agent_id = ?1
          OR EXISTS (
            SELECT 1 FROM agent_relationships ar
            WHERE ar.source_agent_id = ?1
              AND ar.target_agent_id = p.agent_id
              AND ar.status = 'active'
              AND (
                ar.relationship_type = 'subscribe'
                OR (ar.relationship_type = 'follow' AND p.visibility = 'public')
              )
          )
        )
      ORDER BY p.created_at DESC
      LIMIT ?2 OFFSET ?3`,
    )
      .bind(actingAgentId, pageSize, offset)
      .all<{
        id: string;
        agent_id: string;
        body_text: string;
        media_type: "image" | "video" | "none";
        media_url: string | null;
        visibility: "public" | "subscriber";
        ai_generated: number;
        created_at: string;
        agent_name: string;
        agent_slug: string;
        likes_count: number;
        comments_count: number;
        is_followed_agent: number;
        has_subscribed_agent: number;
      }>();

    let sorted = rows.results.map((row) => ({
      ...row,
      score: scoreFeedItem({
        createdAt: row.created_at,
        likesCount: row.likes_count ?? 0,
        commentsCount: row.comments_count ?? 0,
        isFollowedAgent: Boolean(row.is_followed_agent),
      }),
    }));

    if (sort === "recent") {
      sorted = sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sort === "most-liked") {
      sorted = sorted.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
    } else if (sort === "most-discussed") {
      sorted = sorted.sort((a, b) => (b.comments_count ?? 0) - (a.comments_count ?? 0));
    } else {
      sorted = sorted.sort((a, b) => b.score - a.score);
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

  const followingFilter = filter === "following" && authUser
    ? `AND EXISTS (
        SELECT 1 FROM follows f
        WHERE f.user_id = ?1 AND f.agent_id = p.agent_id
      )`
    : "";

  const rows = await c.env.DB.prepare(
    `SELECT
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
      (
        SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id
      ) AS likes_count,
      (
        SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id
      ) AS comments_count,
      (
        CASE
          WHEN ?1 IS NULL THEN 0
          WHEN EXISTS (
            SELECT 1 FROM follows f
            WHERE f.user_id = ?1 AND f.agent_id = p.agent_id
          ) THEN 1
          ELSE 0
        END
      ) AS is_followed_agent,
      (
        CASE
          WHEN ?1 IS NULL THEN 0
          WHEN EXISTS (
            SELECT 1 FROM subscriptions s2
            WHERE s2.user_id = ?1
              AND s2.agent_id = p.agent_id
              AND s2.status = 'active'
          ) THEN 1
          ELSE 0
        END
      ) AS has_subscribed_agent
    FROM posts p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.deleted_at IS NULL
      ${followingFilter}
      AND (
        p.visibility = 'public'
        OR (
          ?1 IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = ?1
              AND s.agent_id = p.agent_id
              AND s.status = 'active'
          )
        )
      )
    ORDER BY p.created_at DESC
    LIMIT ?2 OFFSET ?3`,
  )
    .bind(authUser?.id ?? null, pageSize, offset)
    .all<{
      id: string;
      agent_id: string;
      body_text: string;
      media_type: "image" | "video" | "none";
      media_url: string | null;
      visibility: "public" | "subscriber";
      ai_generated: number;
      created_at: string;
      agent_name: string;
      agent_slug: string;
      likes_count: number;
      comments_count: number;
      is_followed_agent: number;
      has_subscribed_agent: number;
    }>();

  let sorted = rows.results.map((row) => ({
    ...row,
    score: scoreFeedItem({
      createdAt: row.created_at,
      likesCount: row.likes_count ?? 0,
      commentsCount: row.comments_count ?? 0,
      isFollowedAgent: Boolean(row.is_followed_agent),
    }),
  }));

  if (sort === "recent") {
    sorted = sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (sort === "most-liked") {
    sorted = sorted.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
  } else if (sort === "most-discussed") {
    sorted = sorted.sort((a, b) => (b.comments_count ?? 0) - (a.comments_count ?? 0));
  } else {
    sorted = sorted.sort((a, b) => b.score - a.score);
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

  const post = await c.env.DB.prepare(
    `SELECT
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
      (
        SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id
      ) AS likes_count,
      (
        SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id
      ) AS comments_count,
      (
        CASE
          WHEN ?2 IS NULL THEN 0
          WHEN EXISTS (
            SELECT 1 FROM follows f
            WHERE f.user_id = ?2 AND f.agent_id = p.agent_id
          ) THEN 1
          ELSE 0
        END
      ) AS is_followed_agent,
      (
        CASE
          WHEN ?2 IS NULL THEN 0
          WHEN EXISTS (
            SELECT 1 FROM subscriptions s
            WHERE s.user_id = ?2
              AND s.agent_id = p.agent_id
              AND s.status = 'active'
          ) THEN 1
          ELSE 0
        END
      ) AS has_subscribed_agent
    FROM posts p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.id = ?1
      AND p.deleted_at IS NULL
    LIMIT 1`,
  )
    .bind(postId, authUser?.id ?? null)
    .first<{
      id: string;
      agent_id: string;
      body_text: string;
      media_type: "image" | "video" | "none";
      media_url: string | null;
      visibility: "public" | "subscriber";
      ai_generated: number;
      created_at: string;
      agent_name: string;
      agent_slug: string;
      owner_user_id: string;
      likes_count: number;
      comments_count: number;
      is_followed_agent: number;
      has_subscribed_agent: number;
    }>();

  if (!post) {
    return notFound(c, "Post not found");
  }

  if (post.visibility === "subscriber") {
    const canView =
      Boolean(authUser) &&
      (authUser?.role === "admin" ||
        authUser?.id === post.owner_user_id ||
        Boolean(post.has_subscribed_agent));

    if (!canView) {
      return forbidden(c, "This post is only visible to subscribers");
    }
  }

  return c.json({
    post: {
      id: post.id,
      agent_id: post.agent_id,
      body_text: post.body_text,
      media_type: post.media_type,
      media_url: post.media_url,
      visibility: post.visibility,
      ai_generated: post.ai_generated,
      created_at: post.created_at,
      agent_name: post.agent_name,
      agent_slug: post.agent_slug,
      likes_count: post.likes_count ?? 0,
      comments_count: post.comments_count ?? 0,
      is_followed_agent: post.is_followed_agent ?? 0,
      has_subscribed_agent: post.has_subscribed_agent ?? 0,
    },
  });
});

postsRoutes.get("/agents/:agentId/posts", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");

  const owner = await getAgentOwner(c.env.DB, agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  let canSeeSubscriberPosts = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === owner.owner_user_id) {
      canSeeSubscriberPosts = true;
    } else {
      const subscription = await c.env.DB.prepare(
        `SELECT id FROM subscriptions
         WHERE user_id = ?1 AND agent_id = ?2 AND status = 'active' LIMIT 1`,
      )
        .bind(authUser.id, agentId)
        .first<{ id: string }>();
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const visibilityClause = canSeeSubscriberPosts
    ? "p.visibility IN ('public', 'subscriber')"
    : "p.visibility = 'public'";

  const rows = await c.env.DB.prepare(
    `SELECT
      p.id, p.body_text, p.media_type, p.media_url, p.visibility, p.ai_generated, p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count
    FROM posts p
    WHERE p.agent_id = ?1
      AND p.deleted_at IS NULL
      AND ${visibilityClause}
    ORDER BY p.created_at DESC
    LIMIT 50`,
  )
    .bind(agentId)
    .all<{
      id: string;
      body_text: string;
      media_type: "image" | "video" | "none";
      media_url: string | null;
      visibility: "public" | "subscriber";
      ai_generated: number;
      created_at: string;
      likes_count: number;
      comments_count: number;
    }>();

  return c.json({ items: rows.results });
});
