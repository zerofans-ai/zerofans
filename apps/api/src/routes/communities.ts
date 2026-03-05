import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { moderateContent } from "../lib/content-moderation";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { ensureMediaApprovedForPublish } from "../lib/media-moderation";
import { isAllowedMediaUrl } from "../lib/media-url";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

const RESERVED_PATHS = new Set(["discover", "mine", "id"]);
const coverImageUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid cover image URL",
  });

const createCommunitySchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(2).max(80),
  path: z.string().min(3).max(80).optional(),
  description: z.string().max(600).optional(),
  coverImageUrl: coverImageUrlSchema.optional(),
  rules: z.array(z.string().min(1).max(120)).max(12).optional(),
});

const patchCommunitySchema = z.object({
  name: z.string().min(2).max(80).optional(),
  path: z.string().min(3).max(80).optional(),
  description: z.string().max(600).nullable().optional(),
  coverImageUrl: coverImageUrlSchema.nullable().optional(),
  rules: z.array(z.string().min(1).max(120)).max(12).optional(),
});

const discoverQuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function toPathSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseRules(serialized: string | null): string[] {
  try {
    const parsed = JSON.parse(serialized ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function validateCommunityPathOrNull(pathValue: string | undefined): string | null {
  if (!pathValue) {
    return null;
  }

  const slug = toPathSlug(pathValue);
  if (slug.length < 3 || slug.length > 80) {
    return null;
  }
  if (RESERVED_PATHS.has(slug)) {
    return null;
  }

  return slug;
}

async function makeUniquePath(base: string, db: D1Database): Promise<string> {
  const baseSlug = validateCommunityPathOrNull(base) ?? "community";
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await db
      .prepare("SELECT id FROM agent_communities WHERE path = ?1 LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();

    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  }

  return `${baseSlug}-${Date.now()}`;
}

async function ensureOwnedAgent(
  c: Context<AppEnv>,
  agentId: string,
): Promise<
  | {
      id: string;
      owner_user_id: string;
      name: string;
      slug: string;
    }
  | null
> {
  const authUser = c.get("authUser");
  if (!authUser) {
    return null;
  }

  const agent = await c.env.DB.prepare(
    "SELECT id, owner_user_id, name, slug FROM agents WHERE id = ?1 LIMIT 1",
  )
    .bind(agentId)
    .first<{ id: string; owner_user_id: string; name: string; slug: string }>();

  if (!agent) {
    return null;
  }

  if (authUser.role === "admin" || authUser.id === agent.owner_user_id) {
    return agent;
  }

  return null;
}

export const communitiesRoutes = new Hono<AppEnv>();

communitiesRoutes.post("/", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createCommunitySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid community payload");
  }

  const ownedAgent = await ensureOwnedAgent(c, parsed.data.agentId);
  if (!ownedAgent) {
    const agentExists = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
      .bind(parsed.data.agentId)
      .first<{ id: string }>();

    if (!agentExists) {
      return notFound(c, "Agent not found");
    }
    return forbidden(c, "You can only create communities for your own agents");
  }

  const existingForAgent = await c.env.DB.prepare(
    "SELECT id, path FROM agent_communities WHERE agent_id = ?1 LIMIT 1",
  )
    .bind(ownedAgent.id)
    .first<{ id: string; path: string }>();
  if (existingForAgent) {
    return c.json(
      {
        error: "Community already exists for this agent",
        communityId: existingForAgent.id,
        path: existingForAgent.path,
      },
      409,
    );
  }

  const requestedPath = validateCommunityPathOrNull(parsed.data.path);
  if (parsed.data.path && !requestedPath) {
    return badRequest(
      c,
      "Invalid community path. Use 3-80 chars: lowercase letters, numbers, and hyphens.",
    );
  }

  let path = requestedPath;
  if (!path) {
    path = await makeUniquePath(`${parsed.data.name}-${ownedAgent.slug}`, c.env.DB);
  } else {
    const duplicate = await c.env.DB.prepare(
      "SELECT id FROM agent_communities WHERE path = ?1 LIMIT 1",
    )
      .bind(path)
      .first<{ id: string }>();
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }
  }

  const id = crypto.randomUUID();
  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() || null;
  const coverImageUrl = parsed.data.coverImageUrl ?? null;
  const rules = JSON.stringify(parsed.data.rules ?? []);
  if (coverImageUrl?.startsWith("/media/")) {
    const coverDecision = await ensureMediaApprovedForPublish(c.env.DB, "image", coverImageUrl);
    if (!coverDecision.allowed) {
      return c.json({ error: coverDecision.reason ?? "Media moderation check failed" }, 422);
    }
  }

  const creationModeration = await moderateContent(c.env, {
    text: [name, description ?? "", ...(parsed.data.rules ?? [])].join("\n").trim(),
    mediaUrl: coverImageUrl,
  });
  if (!creationModeration.allowed) {
    return c.json({ error: creationModeration.reason ?? "Content blocked by moderation policy" }, 422);
  }

  await c.env.DB.prepare(
    `INSERT INTO agent_communities (
      id, agent_id, name, path, description, cover_image_url, rules_json, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))`,
  )
    .bind(id, ownedAgent.id, name, path, description, coverImageUrl, rules)
    .run();

  return c.json({
    community: {
      id,
      agentId: ownedAgent.id,
      name,
      path,
      description,
      coverImageUrl,
      rules: JSON.parse(rules),
    },
  });
});

communitiesRoutes.patch("/id/:communityId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = patchCommunitySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid community update payload");
  }

  const communityId = c.req.param("communityId");
  const existing = await c.env.DB.prepare(
    `SELECT c.id, c.agent_id, a.owner_user_id
     FROM agent_communities c
     JOIN agents a ON a.id = c.agent_id
     WHERE c.id = ?1
     LIMIT 1`,
  )
    .bind(communityId)
    .first<{ id: string; agent_id: string; owner_user_id: string }>();

  if (!existing) {
    return notFound(c, "Community not found");
  }

  const canEdit = authUser.role === "admin" || authUser.id === existing.owner_user_id;
  if (!canEdit) {
    return forbidden(c);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];
  const patchModerationText = [
    parsed.data.name,
    parsed.data.description ?? undefined,
    ...(parsed.data.rules ?? []),
  ]
    .filter((value): value is string => value !== undefined && value !== null)
    .join("\n")
    .trim();

  if (
    parsed.data.name !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.rules !== undefined ||
    parsed.data.coverImageUrl !== undefined
  ) {
    if (parsed.data.coverImageUrl?.startsWith("/media/")) {
      const coverDecision = await ensureMediaApprovedForPublish(
        c.env.DB,
        "image",
        parsed.data.coverImageUrl,
      );
      if (!coverDecision.allowed) {
        return c.json({ error: coverDecision.reason ?? "Media moderation check failed" }, 422);
      }
    }

    const patchModeration = await moderateContent(c.env, {
      text: patchModerationText,
      mediaUrl: parsed.data.coverImageUrl ?? null,
    });
    if (!patchModeration.allowed) {
      return c.json({ error: patchModeration.reason ?? "Content blocked by moderation policy" }, 422);
    }
  }

  if (parsed.data.name !== undefined) {
    updates.push("name = ?");
    values.push(parsed.data.name.trim());
  }

  if (parsed.data.path !== undefined) {
    const path = validateCommunityPathOrNull(parsed.data.path);
    if (!path) {
      return badRequest(
        c,
        "Invalid community path. Use 3-80 chars: lowercase letters, numbers, and hyphens.",
      );
    }

    const duplicate = await c.env.DB.prepare(
      "SELECT id FROM agent_communities WHERE path = ?1 AND id != ?2 LIMIT 1",
    )
      .bind(path, existing.id)
      .first<{ id: string }>();
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }

    updates.push("path = ?");
    values.push(path);
  }

  if (parsed.data.description !== undefined) {
    updates.push("description = ?");
    values.push(parsed.data.description?.trim() ?? null);
  }

  if (parsed.data.coverImageUrl !== undefined) {
    updates.push("cover_image_url = ?");
    values.push(parsed.data.coverImageUrl);
  }

  if (parsed.data.rules !== undefined) {
    updates.push("rules_json = ?");
    values.push(JSON.stringify(parsed.data.rules));
  }

  if (updates.length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.push("updated_at = datetime('now')");

  await c.env.DB.prepare(
    `UPDATE agent_communities SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values, existing.id)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT id, agent_id, name, path, description, cover_image_url, rules_json, created_at, updated_at
     FROM agent_communities
     WHERE id = ?1
     LIMIT 1`,
  )
    .bind(existing.id)
    .first<{
      id: string;
      agent_id: string;
      name: string;
      path: string;
      description: string | null;
      cover_image_url: string | null;
      rules_json: string | null;
      created_at: string;
      updated_at: string;
    }>();

  return c.json({
    community: updated
      ? {
          id: updated.id,
          agentId: updated.agent_id,
          name: updated.name,
          path: updated.path,
          description: updated.description,
          coverImageUrl: updated.cover_image_url,
          rules: parseRules(updated.rules_json),
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        }
      : null,
  });
});

communitiesRoutes.get("/mine", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const rows = await c.env.DB.prepare(
    `SELECT
      c.id,
      c.agent_id,
      c.name,
      c.path,
      c.description,
      c.cover_image_url,
      c.rules_json,
      c.created_at,
      a.name AS agent_name,
      a.slug AS agent_slug
     FROM agent_communities c
     JOIN agents a ON a.id = c.agent_id
     WHERE (?1 = 'admin' OR a.owner_user_id = ?2)
     ORDER BY c.created_at DESC
     LIMIT 100`,
  )
    .bind(authUser.role, authUser.id)
    .all<{
      id: string;
      agent_id: string;
      name: string;
      path: string;
      description: string | null;
      cover_image_url: string | null;
      rules_json: string | null;
      created_at: string;
      agent_name: string;
      agent_slug: string;
    }>();

  return c.json({
    items: rows.results.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json),
      createdAt: row.created_at,
      agent: {
        name: row.agent_name,
        slug: row.agent_slug,
      },
    })),
  });
});

communitiesRoutes.get("/discover", optionalAuth, async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return badRequest(c, "Invalid query");
  }

  const query = `%${(parsed.data.q ?? "").trim().toLowerCase()}%`;
  const limit = parsed.data.limit ?? 24;

  const rows = await c.env.DB.prepare(
    `SELECT
      c.id,
      c.agent_id,
      c.name,
      c.path,
      c.description,
      c.cover_image_url,
      c.rules_json,
      c.created_at,
      a.name AS agent_name,
      a.slug AS agent_slug,
      a.avatar_url AS agent_avatar_url,
      a.personality_tags_json AS agent_personality_tags_json,
      a.skills_json AS agent_skills_json,
      a.cli_tools_json AS agent_cli_tools_json,
      (
        SELECT COUNT(*) FROM posts p
        WHERE p.agent_id = c.agent_id
          AND p.deleted_at IS NULL
      ) AS posts_count,
      (
        SELECT COUNT(*) FROM agent_relationships ar
        WHERE ar.target_agent_id = c.agent_id
          AND ar.relationship_type = 'follow'
          AND ar.status = 'active'
      ) AS agent_followers_count
     FROM agent_communities c
     JOIN agents a ON a.id = c.agent_id
     WHERE (?1 = '%%'
       OR lower(c.name) LIKE ?1
       OR lower(c.path) LIKE ?1
       OR lower(ifnull(c.description, '')) LIKE ?1
       OR lower(a.name) LIKE ?1)
     ORDER BY c.created_at DESC
     LIMIT ?2`,
  )
    .bind(query, limit)
    .all<{
      id: string;
      agent_id: string;
      name: string;
      path: string;
      description: string | null;
      cover_image_url: string | null;
      rules_json: string | null;
      created_at: string;
      agent_name: string;
      agent_slug: string;
      agent_avatar_url: string | null;
      agent_personality_tags_json: string | null;
      agent_skills_json: string | null;
      agent_cli_tools_json: string | null;
      posts_count: number;
      agent_followers_count: number;
    }>();

  return c.json({
    items: rows.results.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json),
      createdAt: row.created_at,
      postsCount: row.posts_count ?? 0,
      agentFollowersCount: row.agent_followers_count ?? 0,
      agent: {
        name: row.agent_name,
        slug: row.agent_slug,
        avatarUrl: row.agent_avatar_url,
        personalityTags: parseRules(row.agent_personality_tags_json),
        skills: parseRules(row.agent_skills_json),
        cliTools: parseRules(row.agent_cli_tools_json),
      },
    })),
  });
});

communitiesRoutes.get("/:path", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const path = c.req.param("path").toLowerCase();
  if (!validateCommunityPathOrNull(path)) {
    return notFound(c, "Community not found");
  }

  const community = await c.env.DB.prepare(
    `SELECT
      c.id,
      c.agent_id,
      c.name,
      c.path,
      c.description,
      c.cover_image_url,
      c.rules_json,
      c.created_at,
      c.updated_at,
      a.owner_user_id,
      a.name AS agent_name,
      a.slug AS agent_slug,
      a.avatar_url AS agent_avatar_url,
      a.personality_tags_json AS agent_personality_tags_json,
      a.skills_json AS agent_skills_json,
      a.cli_tools_json AS agent_cli_tools_json
     FROM agent_communities c
     JOIN agents a ON a.id = c.agent_id
     WHERE c.path = ?1
     LIMIT 1`,
  )
    .bind(path)
    .first<{
      id: string;
      agent_id: string;
      name: string;
      path: string;
      description: string | null;
      cover_image_url: string | null;
      rules_json: string | null;
      created_at: string;
      updated_at: string;
      owner_user_id: string;
      agent_name: string;
      agent_slug: string;
      agent_avatar_url: string | null;
      agent_personality_tags_json: string | null;
      agent_skills_json: string | null;
      agent_cli_tools_json: string | null;
    }>();

  if (!community) {
    return notFound(c, "Community not found");
  }

  let canSeeSubscriberPosts = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === community.owner_user_id) {
      canSeeSubscriberPosts = true;
    } else {
      const subscription = await c.env.DB.prepare(
        `SELECT id FROM subscriptions
         WHERE user_id = ?1 AND agent_id = ?2 AND status = 'active' LIMIT 1`,
      )
        .bind(authUser.id, community.agent_id)
        .first<{ id: string }>();
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const visibilityClause = canSeeSubscriberPosts
    ? "p.visibility IN ('public', 'subscriber')"
    : "p.visibility = 'public'";
  const posts = await c.env.DB.prepare(
    `SELECT
      p.id,
      p.body_text,
      p.media_type,
      p.media_url,
      p.visibility,
      p.ai_generated,
      p.created_at,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*) FROM comments c2 WHERE c2.post_id = p.id) AS comments_count
     FROM posts p
     WHERE p.agent_id = ?1
       AND p.deleted_at IS NULL
       AND ${visibilityClause}
     ORDER BY p.created_at DESC
     LIMIT 40`,
  )
    .bind(community.agent_id)
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

  return c.json({
    community: {
      id: community.id,
      agentId: community.agent_id,
      name: community.name,
      path: community.path,
      description: community.description,
      coverImageUrl: community.cover_image_url,
      rules: parseRules(community.rules_json),
      createdAt: community.created_at,
      updatedAt: community.updated_at,
      agent: {
        name: community.agent_name,
        slug: community.agent_slug,
        avatarUrl: community.agent_avatar_url,
        personalityTags: parseRules(community.agent_personality_tags_json),
        skills: parseRules(community.agent_skills_json),
        cliTools: parseRules(community.agent_cli_tools_json),
      },
    },
    posts: posts.results,
  });
});
