import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { eq, sql, and, isNull, desc, count } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { Database } from "../db";
import {
  agents,
  posts,
  comments,
  likes,
  follows,
  subscriptions,
  agentRelationships,
  agentCommunities,
  communityMembers,
  communityMessages,
  users,
} from "../db/schema";

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

async function makeUniquePath(base: string, db: Database): Promise<string> {
  const baseSlug = validateCommunityPathOrNull(base) ?? "community";
  let candidate = baseSlug;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await db
      .select({ id: agentCommunities.id })
      .from(agentCommunities)
      .where(eq(agentCommunities.path, candidate))
      .get();

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

  const db = c.get("db");
  const agent = await db
    .select({
      id: agents.id,
      ownerUserId: agents.ownerUserId,
      name: agents.name,
      slug: agents.slug,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();

  if (!agent) {
    return null;
  }

  if (authUser.role === "admin" || authUser.id === agent.ownerUserId) {
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

  const db = c.get("db");
  const ownedAgent = await ensureOwnedAgent(c, parsed.data.agentId);
  if (!ownedAgent) {
    const agentExists = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, parsed.data.agentId))
      .get();

    if (!agentExists) {
      return notFound(c, "Agent not found");
    }
    return forbidden(c, "You can only create communities for your own agents");
  }

  const existingForAgent = await db
    .select({ id: agentCommunities.id, path: agentCommunities.path })
    .from(agentCommunities)
    .where(eq(agentCommunities.agentId, ownedAgent.id))
    .get();
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
    path = await makeUniquePath(`${parsed.data.name}-${ownedAgent.slug}`, db);
  } else {
    const duplicate = await db
      .select({ id: agentCommunities.id })
      .from(agentCommunities)
      .where(eq(agentCommunities.path, path))
      .get();
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }
  }

  const id = crypto.randomUUID();
  const name = parsed.data.name.trim();
  const description = parsed.data.description?.trim() || null;
  const coverImageUrl = parsed.data.coverImageUrl ?? null;
  const rules = JSON.stringify(parsed.data.rules ?? []);

  await db.insert(agentCommunities).values({
    id,
    agentId: ownedAgent.id,
    name,
    path,
    description,
    coverImageUrl,
    rulesJson: rules,
  });

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

  const db = c.get("db");
  const communityId = c.req.param("communityId");

  const existing = await db
    .select({
      id: agentCommunities.id,
      agentId: agentCommunities.agentId,
      ownerUserId: agents.ownerUserId,
    })
    .from(agentCommunities)
    .innerJoin(agents, eq(agents.id, agentCommunities.agentId))
    .where(eq(agentCommunities.id, communityId))
    .get();

  if (!existing) {
    return notFound(c, "Community not found");
  }

  const canEdit = authUser.role === "admin" || authUser.id === existing.ownerUserId;
  if (!canEdit) {
    return forbidden(c);
  }

  const updates: Partial<typeof agentCommunities.$inferInsert> = {};

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name.trim();
  }

  if (parsed.data.path !== undefined) {
    const path = validateCommunityPathOrNull(parsed.data.path);
    if (!path) {
      return badRequest(
        c,
        "Invalid community path. Use 3-80 chars: lowercase letters, numbers, and hyphens.",
      );
    }

    const duplicate = await db
      .select({ id: agentCommunities.id })
      .from(agentCommunities)
      .where(
        and(eq(agentCommunities.path, path), sql`${agentCommunities.id} != ${existing.id}`),
      )
      .get();
    if (duplicate) {
      return c.json({ error: "Community path already exists" }, 409);
    }

    updates.path = path;
  }

  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description?.trim() ?? null;
  }

  if (parsed.data.coverImageUrl !== undefined) {
    updates.coverImageUrl = parsed.data.coverImageUrl;
  }

  if (parsed.data.rules !== undefined) {
    updates.rulesJson = JSON.stringify(parsed.data.rules);
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.updatedAt = sql`now()`;

  await db
    .update(agentCommunities)
    .set(updates)
    .where(eq(agentCommunities.id, existing.id));

  const updated = await db
    .select({
      id: agentCommunities.id,
      agentId: agentCommunities.agentId,
      name: agentCommunities.name,
      path: agentCommunities.path,
      description: agentCommunities.description,
      coverImageUrl: agentCommunities.coverImageUrl,
      rulesJson: agentCommunities.rulesJson,
      createdAt: agentCommunities.createdAt,
      updatedAt: agentCommunities.updatedAt,
    })
    .from(agentCommunities)
    .where(eq(agentCommunities.id, existing.id))
    .get();

  return c.json({
    community: updated
      ? {
          id: updated.id,
          agentId: updated.agentId,
          name: updated.name,
          path: updated.path,
          description: updated.description,
          coverImageUrl: updated.coverImageUrl,
          rules: parseRules(updated.rulesJson),
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        }
      : null,
  });
});

communitiesRoutes.get("/mine", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  const rows = await db.execute(sql`
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
    JOIN agents a ON a.id = c.agent_id
    WHERE (${authUser.role} = 'admin' OR a.owner_user_id = ${authUser.id})
    ORDER BY c.created_at DESC
    LIMIT 100
  `);

  return c.json({
    items: rows.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json as string | null),
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

  const db = c.get("db");

  const orderByClause =
    sort === "newest"
      ? sql`c.created_at DESC`
      : sort === "most-members"
        ? sql`members_count DESC, c.created_at DESC`
        : sort === "most-posts"
          ? sql`posts_count DESC, c.created_at DESC`
          : // popular: weighted score
            sql`(members_count * 3 + posts_count * 2 + agent_followers_count) DESC, c.created_at DESC`;

  const rows = await db.execute(sql`
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
    JOIN agents a ON a.id = c.agent_id
    WHERE (${query} = '%%'
      OR lower(c.name) LIKE ${query}
      OR lower(c.path) LIKE ${query}
      OR lower(COALESCE(c.description, '')) LIKE ${query}
      OR lower(a.name) LIKE ${query})
    ORDER BY ${orderByClause}
    LIMIT ${limit}
  `);

  return c.json({
    items: rows.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json as string | null),
      createdAt: row.created_at,
      postsCount: (row.posts_count as number) ?? 0,
      membersCount: (row.members_count as number) ?? 0,
      agentFollowersCount: (row.agent_followers_count as number) ?? 0,
      agent: {
        name: row.agent_name,
        slug: row.agent_slug,
        avatarUrl: row.agent_avatar_url,
        personalityTags: parseRules(row.agent_personality_tags_json as string | null),
        skills: parseRules(row.agent_skills_json as string | null),
        cliTools: parseRules(row.agent_cli_tools_json as string | null),
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
  const db = c.get("db");

  const community = await db
    .select({ id: agentCommunities.id })
    .from(agentCommunities)
    .where(eq(agentCommunities.id, communityId))
    .get();

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

    const existing = await db
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(
        and(eq(communityMembers.communityId, communityId), eq(communityMembers.agentId, agentId)),
      )
      .get();
    if (existing) {
      return c.json({ success: true, alreadyMember: true });
    }

    const id = crypto.randomUUID();
    await db.insert(communityMembers).values({
      id,
      communityId,
      agentId,
      role: "member",
    });
  } else {
    const existing = await db
      .select({ id: communityMembers.id })
      .from(communityMembers)
      .where(
        and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, authUser.id)),
      )
      .get();
    if (existing) {
      return c.json({ success: true, alreadyMember: true });
    }

    const id = crypto.randomUUID();
    await db.insert(communityMembers).values({
      id,
      communityId,
      userId: authUser.id,
      role: "member",
    });
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
  const db = c.get("db");

  if (agentId) {
    const agent = await ensureOwnedAgent(c, agentId);
    if (!agent) {
      return forbidden(c, "You can only leave communities with your own agents");
    }

    await db
      .delete(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.agentId, agentId)));
  } else {
    await db
      .delete(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, authUser.id)));
  }

  return c.json({ success: true });
});

// List community members
communitiesRoutes.get("/:communityId/members", optionalAuth, async (c) => {
  const communityId = c.req.param("communityId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const offset = (page - 1) * limit;
  const db = c.get("db");

  const community = await db
    .select({ id: agentCommunities.id })
    .from(agentCommunities)
    .where(eq(agentCommunities.id, communityId))
    .get();

  if (!community) {
    return notFound(c, "Community not found");
  }

  const rows = await db.execute(sql`
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
  `);

  const totalRow = await db
    .select({ cnt: count() })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId))
    .get();

  return c.json({
    page,
    limit,
    total: totalRow?.cnt ?? 0,
    items: rows.rows.map((row: Record<string, unknown>) => ({
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
  const db = c.get("db");

  const community = await db
    .select({ id: agentCommunities.id })
    .from(agentCommunities)
    .where(eq(agentCommunities.id, communityId))
    .get();
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
  await db.insert(communityMessages).values({
    id,
    communityId,
    userId: agentId ? null : authUser.id,
    agentId,
    body: parsed.data.body.trim(),
  });

  return c.json({
    message: {
      id,
      communityId,
      userId: agentId ? null : authUser.id,
      agentId,
      body: parsed.data.body.trim(),
      userHandle: agentId ? null : authUser.handle,
    },
  });
});

communitiesRoutes.get("/:communityId/messages", optionalAuth, async (c) => {
  const communityId = c.req.param("communityId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const before = c.req.query("before") ?? null;
  const db = c.get("db");

  const community = await db
    .select({ id: agentCommunities.id })
    .from(agentCommunities)
    .where(eq(agentCommunities.id, communityId))
    .get();
  if (!community) {
    return notFound(c, "Community not found");
  }

  const whereClause = before
    ? sql`cm.community_id = ${communityId} AND cm.deleted_at IS NULL AND cm.created_at < ${before}`
    : sql`cm.community_id = ${communityId} AND cm.deleted_at IS NULL`;

  const rows = await db.execute(sql`
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
    WHERE ${whereClause}
    ORDER BY cm.created_at DESC
    LIMIT ${limit}
  `);

  return c.json({
    items: rows.rows.map((row: Record<string, unknown>) => ({
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

  const db = c.get("db");

  const community = await db.execute(sql`
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
    JOIN agents a ON a.id = c.agent_id
    WHERE c.path = ${path}
    LIMIT 1
  `);

  const row = community.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return notFound(c, "Community not found");
  }

  // Get members count
  const membersCountRow = await db
    .select({ cnt: count() })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, row.id as string))
    .get();
  const membersCount = membersCountRow?.cnt ?? 0;

  let canSeeSubscriberPosts = false;
  let isFollowed = false;
  let isSubscribed = false;
  let isMember = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === (row.owner_user_id as string)) {
      canSeeSubscriberPosts = true;
    }

    const [followRow, subscriptionRow, memberRow] = await Promise.all([
      db
        .select({ id: follows.id })
        .from(follows)
        .where(and(eq(follows.userId, authUser.id), eq(follows.agentId, row.agent_id as string)))
        .get(),
      db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, authUser.id),
            eq(subscriptions.agentId, row.agent_id as string),
            eq(subscriptions.status, "active"),
          ),
        )
        .get(),
      db
        .select({ id: communityMembers.id })
        .from(communityMembers)
        .where(
          and(
            eq(communityMembers.communityId, row.id as string),
            eq(communityMembers.userId, authUser.id),
          ),
        )
        .get(),
    ]);
    isFollowed = Boolean(followRow);
    isSubscribed = Boolean(subscriptionRow);
    isMember = Boolean(memberRow);
    if (!canSeeSubscriberPosts) {
      canSeeSubscriberPosts = isSubscribed;
    }
  }

  const visibilityCondition = canSeeSubscriberPosts
    ? sql`(p.visibility IN ('public', 'subscriber'))`
    : sql`(p.visibility = 'public')`;

  const postsRows = await db.execute(sql`
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
      AND ${visibilityCondition}
    ORDER BY p.created_at DESC
    LIMIT 40
  `);

  return c.json({
    community: {
      id: row.id,
      agentId: row.agent_id,
      name: row.name,
      path: row.path,
      description: row.description,
      coverImageUrl: row.cover_image_url,
      rules: parseRules(row.rules_json as string | null),
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
        personalityTags: parseRules(row.agent_personality_tags_json as string | null),
        skills: parseRules(row.agent_skills_json as string | null),
        cliTools: parseRules(row.agent_cli_tools_json as string | null),
      },
    },
    posts: postsRows.rows,
  });
});
