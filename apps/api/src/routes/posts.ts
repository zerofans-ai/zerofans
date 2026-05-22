import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { isAllowedMediaUrl } from "../lib/media-url";
import { scoreFeedItem } from "../lib/feed-score";
import { hashContent, signContent, decryptPrivateKey } from "../lib/signing";
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
  sql: ReturnType<typeof import("../db")["createSql"]>,
  agentId: string,
): Promise<{ owner_user_id: string } | null> {
  const row = await firstRow(sql`
    SELECT owner_user_id FROM agents WHERE id = ${agentId}
  `);
  return (row as { owner_user_id: string } | undefined) ?? null;
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

  const sql = c.get("sql");
  const owner = await getAgentOwner(sql, parsed.data.agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  const canCreate = owner.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canCreate) {
    return forbidden(c, "You can only post for your own agent");
  }

  const postId = crypto.randomUUID();

  const bodyText = parsed.data.bodyText.trim();
  const signingSecret = c.env.SIGNING_SECRET;
  let contentHash: string | null = null;
  let signature: string | null = null;

  if (signingSecret) {
    contentHash = await hashContent(bodyText);
    const agent = await firstRow(sql`
      SELECT private_key_encrypted FROM agents WHERE id = ${parsed.data.agentId}
    `);
    if (agent?.private_key_encrypted) {
      const privateKey = await decryptPrivateKey(agent.private_key_encrypted, signingSecret);
      signature = await signContent(privateKey, contentHash);
    }
  }

  await sql`
    INSERT INTO posts (id, agent_id, visibility, body_text, media_type, media_url, ai_generated, content_hash, signature)
    VALUES (${postId}, ${parsed.data.agentId}, ${parsed.data.visibility}, ${bodyText}, ${parsed.data.mediaType}, ${parsed.data.mediaUrl ?? null}, false, ${contentHash}, ${signature})
  `;

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

  const sql = c.get("sql");
  const postId = c.req.param("postId");

  const post = await firstRow(sql`
    SELECT p.id, p.agent_id, p.body_text, p.media_type, p.media_url, a.owner_user_id
    FROM posts p
    INNER JOIN agents a ON a.id = p.agent_id
    WHERE p.id = ${postId} AND p.deleted_at IS NULL
  `);

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canEdit = post.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canEdit) {
    return forbidden(c);
  }

  // Build dynamic SET clause
  const setParts: string[] = [];
  const setValues: unknown[] = [];

  if (parsed.data.visibility !== undefined) {
    setParts.push(`visibility = $${setValues.length + 1}`);
    setValues.push(parsed.data.visibility);
  }
  if (parsed.data.bodyText !== undefined) {
    setParts.push(`body_text = $${setValues.length + 1}`);
    setValues.push(parsed.data.bodyText.trim());
  }
  if (parsed.data.mediaType !== undefined) {
    setParts.push(`media_type = $${setValues.length + 1}`);
    setValues.push(parsed.data.mediaType);
  }
  if (parsed.data.mediaUrl !== undefined) {
    setParts.push(`media_url = $${setValues.length + 1}`);
    setValues.push(parsed.data.mediaUrl);
  }

  if (setParts.length === 0) {
    return badRequest(c, "No fields to update");
  }

  // Determine which fields are being updated and execute the appropriate query
  const hasVisibility = parsed.data.visibility !== undefined;
  const hasBodyText = parsed.data.bodyText !== undefined;
  const hasMediaType = parsed.data.mediaType !== undefined;
  const hasMediaUrl = parsed.data.mediaUrl !== undefined;

  const vis = parsed.data.visibility;
  const bText = parsed.data.bodyText?.trim();
  const mType = parsed.data.mediaType;
  const mUrl = parsed.data.mediaUrl;

  // Use conditional queries based on what's being updated
  if (hasVisibility && hasBodyText && hasMediaType && hasMediaUrl) {
    await sql`
      UPDATE posts SET visibility = ${vis}, body_text = ${bText}, media_type = ${mType}, media_url = ${mUrl}, updated_at = now()
      WHERE id = ${post.id}
    `;
  } else if (hasBodyText && hasMediaUrl) {
    await sql`
      UPDATE posts SET body_text = ${bText}, media_url = ${mUrl}, updated_at = now()
      WHERE id = ${post.id}
    `;
  } else if (hasBodyText) {
    await sql`
      UPDATE posts SET body_text = ${bText}, updated_at = now()
      WHERE id = ${post.id}
    `;
  } else if (hasVisibility) {
    await sql`
      UPDATE posts SET visibility = ${vis}, updated_at = now()
      WHERE id = ${post.id}
    `;
  } else if (hasMediaType) {
    await sql`
      UPDATE posts SET media_type = ${mType}, updated_at = now()
      WHERE id = ${post.id}
    `;
  } else if (hasMediaUrl) {
    await sql`
      UPDATE posts SET media_url = ${mUrl}, updated_at = now()
      WHERE id = ${post.id}
    `;
  }

  return c.json({ success: true });
});

postsRoutes.delete("/:postId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const sql = c.get("sql");
  const postId = c.req.param("postId");

  const post = await firstRow(sql`
    SELECT p.id, a.owner_user_id
    FROM posts p
    INNER JOIN agents a ON a.id = p.agent_id
    WHERE p.id = ${postId} AND p.deleted_at IS NULL
  `);

  if (!post) {
    return notFound(c, "Post not found");
  }

  const canDelete = post.owner_user_id === authUser.id || authUser.role === "admin";
  if (!canDelete) {
    return forbidden(c);
  }

  await sql`
    UPDATE posts SET deleted_at = now(), updated_at = now() WHERE id = ${post.id}
  `;

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

  const sql = c.get("sql");

  if (actingAgentId) {
    if (!authUser) {
      return unauthorized(c, "Authentication required for agent feed mode");
    }

    const actor = await firstRow(sql`
      SELECT id, owner_user_id FROM agents WHERE id = ${actingAgentId}
    `);

    if (!actor) {
      return notFound(c, "Acting agent not found");
    }

    const canAccessActor = authUser.role === "admin" || actor.owner_user_id === authUser.id;
    if (!canAccessActor) {
      return forbidden(c, "You can only view feed as an agent you own");
    }

    const rows = await sql`
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
    `;

    type FeedRow = Record<string, unknown> & { score: number };
    let sorted: FeedRow[] = rows.map((row: Record<string, unknown>) => ({
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

  // User feed
  const authUserId = authUser?.id ?? null;

  const followingFilter =
    filter === "following" && authUser
      ? `AND EXISTS (SELECT 1 FROM follows f WHERE f.user_id = '${authUserId}' AND f.agent_id = p.agent_id)`
      : "";

  const rows = followingFilter
    ? await sql`
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
          true AS is_followed_agent,
          (CASE
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
        JOIN follows f ON f.agent_id = p.agent_id AND f.user_id = ${authUserId}
        WHERE p.deleted_at IS NULL
          AND (
            p.visibility = 'public'
            OR (
              ${authUserId}::text IS NOT NULL
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
      `
    : await sql`
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
            WHEN ${authUserId}::text IS NULL THEN false
            WHEN EXISTS (
              SELECT 1 FROM follows f
              WHERE f.user_id = ${authUserId} AND f.agent_id = p.agent_id
            ) THEN true
            ELSE false
          END) AS is_followed_agent,
          (CASE
            WHEN ${authUserId}::text IS NULL THEN false
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
          AND (
            p.visibility = 'public'
            OR (
              ${authUserId}::text IS NOT NULL
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
      `;

  type FeedRow = Record<string, unknown> & { score: number };
  let sorted: FeedRow[] = rows.map((row: Record<string, unknown>) => ({
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
  const sql = c.get("sql");
  const authUserId = authUser?.id ?? null;

  const rows = await sql`
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
        WHEN ${authUserId}::text IS NULL THEN false
        WHEN EXISTS (
          SELECT 1 FROM follows f
          WHERE f.user_id = ${authUserId} AND f.agent_id = p.agent_id
        ) THEN true
        ELSE false
      END) AS is_followed_agent,
      (CASE
        WHEN ${authUserId}::text IS NULL THEN false
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
  `;

  const row = rows[0] as Record<string, unknown> | undefined;

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
  const sql = c.get("sql");

  const owner = await getAgentOwner(sql, agentId);
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  let canSeeSubscriberPosts = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === owner.owner_user_id) {
      canSeeSubscriberPosts = true;
    } else {
      const subscription = await firstRow(sql`
        SELECT id FROM subscriptions
        WHERE user_id = ${authUser.id} AND agent_id = ${agentId} AND status = 'active'
      `);
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const rows = canSeeSubscriberPosts
    ? await sql`
        SELECT
          p.id, p.body_text, p.media_type, p.media_url, p.visibility, p.ai_generated, p.created_at,
          (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
          (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count
        FROM posts p
        WHERE p.agent_id = ${agentId}
          AND p.deleted_at IS NULL
          AND p.visibility IN ('public', 'subscriber')
        ORDER BY p.created_at DESC
        LIMIT 50
      `
    : await sql`
        SELECT
          p.id, p.body_text, p.media_type, p.media_url, p.visibility, p.ai_generated, p.created_at,
          (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
          (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count
        FROM posts p
        WHERE p.agent_id = ${agentId}
          AND p.deleted_at IS NULL
          AND p.visibility = 'public'
        ORDER BY p.created_at DESC
        LIMIT 50
      `;

  return c.json({ items: rows });
});
