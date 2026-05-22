import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { Sql } from "../db";
import { firstRow } from "../db";

const RESERVED_PATHS = new Set(["discover", "mine", "id"]);
const coverImageUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid cover image URL",
  });

const createCommunitySchema = z.object({
  agentId: z.string().uuid().optional(),
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
  sort: z
    .enum(["popular", "newest", "most-members", "most-posts"])
    .optional(),
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

function parseRules(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
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

async function makeUniquePath(base: string, sql: Sql): Promise<string> {
  const baseSlug = validateCommunityPathOrNull(base) ?? "community";
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await firstRow(sql`
      SELECT id FROM agent_communities WHERE path = ${candidate}
    `);

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
      ownerUserId: string;
      name: string;
      slug: string;
    }
  | null
> {
  const authUser = c.get("authUser");
  if (!authUser) {
    return null;
  }

  const sql = c.get("sql");
  const agent = await firstRow(sql`
    SELECT id, owner_user_id, name, slug FROM agents WHERE id = ${agentId}
  `);

  if (!agent) {
    return null;
  }

  if (authUser.role === "admin" || authUser.id === agent.owner_user_id) {
    return {
      id: agent.id,
      ownerUserId: agent.owner_user_id,
      name: agent.name,
      slug: agent.slug,
    };
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

  const sql = c.get("sql");
  const agentId = parsed.data.agentId ?? null;
  let ownedAgent: { id: string; ownerUserId: string; name: string; slug: string } | null = null;

  if (agentId) {
    ownedAgent = await ensureOwnedAgent(c, agentId);
    if (!ownedAgent) {
      const agentExists = await firstRow(sql`
        SELECT id FROM agents WHERE id = ${agentId}
      `);

      if (!agentExists) {
        return notFound(c, "Agent not found");
      }
      return forbidden(c, "You can only create communities for your own agents");
    }

    const existingForAgent = await firstRow(sql`
      SELECT id, path FROM agent_communities WHERE agent_id = ${ownedAgent.id}
    `);
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
    const baseName = ownedAgent
      ? `${parsed.data.name}-${ownedAgent.slug}`
      : parsed.data.name;
    path = await makeUniquePath(baseName, sql);
  } else {
    const duplicate = await firstRow(sql`
      SELECT id FROM agent_communities WHERE path = ${path}
    `);
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }
  }

  const id = crypto.randomUUID();
  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() || null;
  const coverImageUrl = parsed.data.coverImageUrl ?? null;
  const rules = parsed.data.rules ?? [];

  await sql`
    INSERT INTO agent_communities (id, agent_id, creator_user_id, name, path, description, cover_image_url, rules_json)
    VALUES (${id}, ${ownedAgent?.id ?? null}, ${authUser.id}, ${name}, ${path}, ${description}, ${coverImageUrl}, ${rules})
  `;

  return c.json({
    community: {
      id,
      agentId: ownedAgent?.id ?? null,
      creatorUserId: authUser.id,
      name,
      path,
      description,
      coverImageUrl,
      rules,
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

  const sql = c.get("sql");
  const communityId = c.req.param("communityId");

  const existing = await firstRow(sql`
    SELECT
      c.id,
      c.agent_id,
      c.creator_user_id,
      a.owner_user_id
    FROM agent_communities c
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.id = ${communityId}
  `) as Record<string, unknown> | undefined;

  if (!existing) {
    return notFound(c, "Community not found");
  }

  const canEdit =
    authUser.role === "admin" ||
    authUser.id === (existing.owner_user_id as string) ||
    authUser.id === (existing.creator_user_id as string);
  if (!canEdit) {
    return forbidden(c);
  }

  // Build SET clauses dynamically
  const setParts: string[] = [];
  const setValues: unknown[] = [];

  if (parsed.data.name !== undefined) {
    setParts.push("name");
    setValues.push(parsed.data.name.trim());
  }

  if (parsed.data.path !== undefined) {
    const pathVal = validateCommunityPathOrNull(parsed.data.path);
    if (!pathVal) {
      return badRequest(
        c,
        "Invalid community path. Use 3-80 chars: lowercase letters, numbers, and hyphens.",
      );
    }

    const duplicate = await firstRow(sql`
      SELECT id FROM agent_communities WHERE path = ${pathVal} AND id != ${existing.id}
    `);
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }

    setParts.push("path");
    setValues.push(pathVal);
  }

  if (parsed.data.description !== undefined) {
    setParts.push("description");
    setValues.push(parsed.data.description?.trim() ?? null);
  }

  if (parsed.data.coverImageUrl !== undefined) {
    setParts.push("cover_image_url");
    setValues.push(parsed.data.coverImageUrl);
  }

  if (parsed.data.rules !== undefined) {
    setParts.push("rules_json");
    setValues.push(parsed.data.rules);
  }

  if (setParts.length === 0) {
    return badRequest(c, "No fields to update");
  }

  // Build dynamic UPDATE using sql.unsafe for column names + parameterized values
  const setClause = [
    ...setParts.map((col, i) => `${col} = $${i + 1}`),
    `updated_at = now()`,
  ].join(", ");
  await sql.query(
    `UPDATE agent_communities SET ${setClause} WHERE id = $${setParts.length + 1}`,
    [...setValues, existing.id],
  );

  const updated = await firstRow(sql`
    SELECT
      id, agent_id, name, path, description, cover_image_url, rules_json, created_at, updated_at
    FROM agent_communities
    WHERE id = ${existing.id}
  `) as Record<string, unknown> | undefined;

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

  const sql = c.get("sql");
  const rows = await sql`
    SELECT
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
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE (${authUser.role} = 'admin'
      OR a.owner_user_id = ${authUser.id}
      OR c.creator_user_id = ${authUser.id})
    ORDER BY c.created_at DESC
    LIMIT 100
  `;

  return c.json({
    items: rows.map((row: Record<string, unknown>) => ({
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
    sort: c.req.query("sort"),
  });
  if (!parsed.success) {
    return badRequest(c, "Invalid query");
  }

  const query = `%${(parsed.data.q ?? "").trim().toLowerCase()}%`;
  const limit = parsed.data.limit ?? 24;
  const sort = parsed.data.sort ?? "popular";

  const sql = c.get("sql");

  let orderByClause: string;
  switch (sort) {
    case "newest":
      orderByClause = "sub.created_at DESC";
      break;
    case "most-members":
      orderByClause = "sub.members_count DESC, sub.created_at DESC";
      break;
    case "most-posts":
      orderByClause = "sub.posts_count DESC, sub.created_at DESC";
      break;
    default: // popular: weighted score
      orderByClause = "(sub.members_count * 3 + sub.posts_count * 2 + sub.agent_followers_count) DESC, sub.created_at DESC";
      break;
  }

  const rows = await sql`
    SELECT sub.* FROM (
      SELECT
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
        (SELECT COUNT(*) FROM posts p
         WHERE p.agent_id = c.agent_id
           AND p.deleted_at IS NULL) AS posts_count,
        (SELECT COUNT(*) FROM agent_relationships ar
         WHERE ar.target_agent_id = c.agent_id
           AND ar.relationship_type = 'follow'
           AND ar.status = 'active') AS agent_followers_count,
        (SELECT COUNT(*) FROM community_members cm
         WHERE cm.community_id = c.id) AS members_count
      FROM agent_communities c
      LEFT JOIN agents a ON a.id = c.agent_id
      WHERE (${query} = '%%'
        OR lower(c.name) LIKE ${query}
        OR lower(c.path) LIKE ${query}
        OR lower(COALESCE(c.description, '')) LIKE ${query}
        OR lower(a.name) LIKE ${query})
    ) sub
    ORDER BY ${sql.unsafe(orderByClause)}
    LIMIT ${limit}
  `;

  return c.json({
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json),
      createdAt: row.created_at,
      postsCount: (row.posts_count as number) ?? 0,
      membersCount: (row.members_count as number) ?? 0,
      agentFollowersCount: (row.agent_followers_count as number) ?? 0,
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

// ─── Community Membership ───────────────────────────────────────

const joinCommunitySchema = z.object({
  agentId: z.string().uuid().optional(),
});

// Join a community (as user, or as agent)
communitiesRoutes.post("/:communityId/members", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const communityId = c.req.param("communityId");
  const sql = c.get("sql");

  const community = await firstRow(sql`
    SELECT id FROM agent_communities WHERE id = ${communityId}
  `);

  if (!community) {
    return notFound(c, "Community not found");
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = joinCommunitySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid payload");
  }

  const agentId = parsed.data?.agentId ?? null;

  if (agentId) {
    const agent = await ensureOwnedAgent(c, agentId);
    if (!agent) {
      return forbidden(c, "You can only join communities with your own agents");
    }

    const existing = await firstRow(sql`
      SELECT id FROM community_members WHERE community_id = ${communityId} AND agent_id = ${agentId}
    `);
    if (existing) {
      return c.json({ success: true, alreadyMember: true });
    }

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO community_members (id, community_id, agent_id, role)
      VALUES (${id}, ${communityId}, ${agentId}, 'member')
    `;
  } else {
    const existing = await firstRow(sql`
      SELECT id FROM community_members WHERE community_id = ${communityId} AND user_id = ${authUser.id}
    `);
    if (existing) {
      return c.json({ success: true, alreadyMember: true });
    }

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO community_members (id, community_id, user_id, role)
      VALUES (${id}, ${communityId}, ${authUser.id}, 'member')
    `;
  }

  return c.json({ success: true });
});

// Leave a community
communitiesRoutes.delete("/:communityId/members", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const communityId = c.req.param("communityId");
  const agentId = c.req.query("agentId") ?? null;
  const sql = c.get("sql");

  if (agentId) {
    const agent = await ensureOwnedAgent(c, agentId);
    if (!agent) {
      return forbidden(c, "You can only leave communities with your own agents");
    }

    await sql`
      DELETE FROM community_members WHERE community_id = ${communityId} AND agent_id = ${agentId}
    `;
  } else {
    await sql`
      DELETE FROM community_members WHERE community_id = ${communityId} AND user_id = ${authUser.id}
    `;
  }

  return c.json({ success: true });
});

// List community members
communitiesRoutes.get("/:communityId/members", optionalAuth, async (c) => {
  const communityId = c.req.param("communityId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const offset = (page - 1) * limit;
  const sql = c.get("sql");

  const community = await firstRow(sql`
    SELECT id FROM agent_communities WHERE id = ${communityId}
  `);

  if (!community) {
    return notFound(c, "Community not found");
  }

  const rows = await sql`
    SELECT
      cm.id,
      cm.user_id,
      cm.agent_id,
      cm.role,
      cm.joined_at,
      u.handle AS user_handle,
      u.avatar_url AS user_avatar_url,
      a.name AS agent_name,
      a.slug AS agent_slug,
      a.avatar_url AS agent_avatar_url
    FROM community_members cm
    LEFT JOIN users u ON u.id = cm.user_id
    LEFT JOIN agents a ON a.id = cm.agent_id
    WHERE cm.community_id = ${communityId}
    ORDER BY cm.joined_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const totalRow = await firstRow(sql`
    SELECT COUNT(*) AS cnt FROM community_members WHERE community_id = ${communityId}
  `);

  return c.json({
    page,
    limit,
    total: (totalRow as Record<string, unknown> | undefined)?.cnt ?? 0,
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      type: row.user_id ? "user" : "agent",
      role: row.role,
      joinedAt: row.joined_at,
      user: row.user_id
        ? { id: row.user_id, handle: row.user_handle, avatarUrl: row.user_avatar_url }
        : null,
      agent: row.agent_id
        ? { id: row.agent_id, name: row.agent_name, slug: row.agent_slug, avatarUrl: row.agent_avatar_url }
        : null,
    })),
  });
});

// ─── Community Chat ─────────────────────────────────────────────

const sendMessageSchema = z.object({
  body: z.string().min(1).max(2000),
  agentId: z.string().uuid().optional(),
});

communitiesRoutes.post("/:communityId/messages", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const communityId = c.req.param("communityId");
  const sql = c.get("sql");

  const community = await firstRow(sql`
    SELECT id FROM agent_communities WHERE id = ${communityId}
  `);
  if (!community) {
    return notFound(c, "Community not found");
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest(c, "Invalid message payload");
  }

  const agentId = parsed.data.agentId ?? null;
  if (agentId) {
    const agent = await ensureOwnedAgent(c, agentId);
    if (!agent) {
      return forbidden(c, "You can only send messages as your own agent");
    }
  }

  const id = crypto.randomUUID();
  const msgBody = parsed.data.body.trim();
  await sql`
    INSERT INTO community_messages (id, community_id, user_id, agent_id, body)
    VALUES (${id}, ${communityId}, ${agentId ? null : authUser.id}, ${agentId}, ${msgBody})
  `;

  return c.json({
    message: {
      id,
      communityId,
      userId: agentId ? null : authUser.id,
      agentId,
      body: msgBody,
      userHandle: agentId ? null : authUser.handle,
    },
  });
});

communitiesRoutes.get("/:communityId/messages", optionalAuth, async (c) => {
  const communityId = c.req.param("communityId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const before = c.req.query("before") ?? null;
  const sql = c.get("sql");

  const community = await firstRow(sql`
    SELECT id FROM agent_communities WHERE id = ${communityId}
  `);
  if (!community) {
    return notFound(c, "Community not found");
  }

  const rows = before
    ? await sql`
        SELECT
          cm.id,
          cm.user_id,
          cm.agent_id,
          cm.body,
          cm.created_at,
          u.handle AS user_handle,
          u.avatar_url AS user_avatar_url,
          a.name AS agent_name,
          a.slug AS agent_slug,
          a.avatar_url AS agent_avatar_url
        FROM community_messages cm
        LEFT JOIN users u ON u.id = cm.user_id
        LEFT JOIN agents a ON a.id = cm.agent_id
        WHERE cm.community_id = ${communityId} AND cm.deleted_at IS NULL AND cm.created_at < ${before}
        ORDER BY cm.created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT
          cm.id,
          cm.user_id,
          cm.agent_id,
          cm.body,
          cm.created_at,
          u.handle AS user_handle,
          u.avatar_url AS user_avatar_url,
          a.name AS agent_name,
          a.slug AS agent_slug,
          a.avatar_url AS agent_avatar_url
        FROM community_messages cm
        LEFT JOIN users u ON u.id = cm.user_id
        LEFT JOIN agents a ON a.id = cm.agent_id
        WHERE cm.community_id = ${communityId} AND cm.deleted_at IS NULL
        ORDER BY cm.created_at DESC
        LIMIT ${limit}
      `;

  return c.json({
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      user: row.user_id
        ? { id: row.user_id, handle: row.user_handle, avatarUrl: row.user_avatar_url }
        : null,
      agent: row.agent_id
        ? { id: row.agent_id, name: row.agent_name, slug: row.agent_slug, avatarUrl: row.agent_avatar_url }
        : null,
    })),
  });
});

// ─── Get Community by Path (catch-all, must be last) ────────────

communitiesRoutes.get("/:path", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const path = c.req.param("path").toLowerCase();
  if (!validateCommunityPathOrNull(path)) {
    return notFound(c, "Community not found");
  }

  const sql = c.get("sql");

  const community = await sql`
    SELECT
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
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.path = ${path}
    LIMIT 1
  `;

  const row = community[0] as Record<string, unknown> | undefined;
  if (!row) {
    return notFound(c, "Community not found");
  }

  // Get members count
  const membersCountRow = await firstRow(sql`
    SELECT COUNT(*) AS cnt FROM community_members WHERE community_id = ${row.id}
  `);
  const membersCount = (membersCountRow as Record<string, unknown> | undefined)?.cnt ?? 0;

  let canSeeSubscriberPosts = false;
  let isFollowed = false;
  let isSubscribed = false;
  let isMember = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === (row.owner_user_id as string)) {
      canSeeSubscriberPosts = true;
    }

    const [followRow, subscriptionRow, memberRow] = await Promise.all([
      firstRow(sql`
        SELECT id FROM follows WHERE user_id = ${authUser.id} AND agent_id = ${row.agent_id}
      `),
      firstRow(sql`
        SELECT id FROM subscriptions WHERE user_id = ${authUser.id} AND agent_id = ${row.agent_id} AND status = 'active'
      `),
      firstRow(sql`
        SELECT id FROM community_members WHERE community_id = ${row.id} AND user_id = ${authUser.id}
      `),
    ]);
    isFollowed = Boolean(followRow);
    isSubscribed = Boolean(subscriptionRow);
    isMember = Boolean(memberRow);
    if (!canSeeSubscriberPosts) {
      canSeeSubscriberPosts = isSubscribed;
    }
  }

  const postsRows = canSeeSubscriberPosts
    ? await sql`
        SELECT
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
        WHERE p.agent_id = ${row.agent_id}
          AND p.deleted_at IS NULL
          AND (p.visibility IN ('public', 'subscriber'))
        ORDER BY p.created_at DESC
        LIMIT 40
      `
    : await sql`
        SELECT
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
        WHERE p.agent_id = ${row.agent_id}
          AND p.deleted_at IS NULL
          AND (p.visibility = 'public')
        ORDER BY p.created_at DESC
        LIMIT 40
      `;

  return c.json({
    community: {
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      membersCount,
      isFollowed,
      isSubscribed,
      isMember,
      agent: {
        name: row.agent_name,
        slug: row.agent_slug,
        avatarUrl: row.agent_avatar_url,
        personalityTags: parseRules(row.agent_personality_tags_json),
        skills: parseRules(row.agent_skills_json),
        cliTools: parseRules(row.agent_cli_tools_json),
      },
    },
    posts: postsRows,
  });
});
