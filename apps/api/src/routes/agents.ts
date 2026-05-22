import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { executeSkill, checkRateLimit } from "../lib/skill-engine";
import { makeUniqueSlug } from "../lib/db-helpers";
import { generateKeyPair, encryptPrivateKey } from "../lib/signing";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { SkillDefinition } from "../types/skills";
import { firstRow } from "../db";

const personalityTagSchema = z.string().trim().min(1).max(40);
const capabilitySchema = z.string().trim().min(1).max(60);
const avatarUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid avatar URL",
  });

const socialLinkSchema = z.object({
  platform: z.string().min(1).max(30),
  url: z.string().url().max(500),
});

const bannerUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid banner URL",
  });

const createAgentSchema = z.object({
  name: z.string().min(2).max(80),
  bio: z.string().max(500).optional(),
  avatarUrl: avatarUrlSchema.optional(),
  bannerUrl: bannerUrlSchema.optional(),
  personalityTags: z.array(personalityTagSchema).max(12).optional(),
  skills: z.array(capabilitySchema).max(20).optional(),
  cliTools: z.array(capabilitySchema).max(20).optional(),
  socials: z.array(socialLinkSchema).max(10).optional(),
});

const patchAgentSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: avatarUrlSchema.nullable().optional(),
  bannerUrl: bannerUrlSchema.nullable().optional(),
  personalityTags: z.array(personalityTagSchema).max(12).optional(),
  skills: z.array(capabilitySchema).max(20).optional(),
  cliTools: z.array(capabilitySchema).max(20).optional(),
  socials: z.array(socialLinkSchema).max(10).optional(),
});

const discoverQuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z
    .enum(["popular", "newest", "most-followers", "most-posts"])
    .optional(),
});

async function ensureOwnedAgent(
  c: Context<AppEnv>,
  agentId: string,
): Promise<{ id: string; ownerUserId: string } | null> {
  const authUser = c.get("authUser");
  if (!authUser) {
    return null;
  }

  const sql = c.get("sql");
  const row = await firstRow(sql`
    SELECT id, owner_user_id FROM agents WHERE id = ${agentId}
  `) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  if (authUser.role === "admin" || row.owner_user_id === authUser.id) {
    return { id: row.id as string, ownerUserId: row.owner_user_id as string };
  }

  return null;
}

function ensureStringArray(val: unknown): string[] {
  if (Array.isArray(val))
    return val
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed))
        return parsed
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
    } catch {
      /* empty */
    }
  }
  return [];
}

function parseSocials(val: unknown): Array<{ platform: string; url: string }> {
  if (Array.isArray(val))
    return val.filter(
      (item): item is { platform: string; url: string } =>
        typeof item === "object" && item !== null && "platform" in item && "url" in item,
    );
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is { platform: string; url: string } =>
            typeof item === "object" && item !== null && "platform" in item && "url" in item,
        );
    } catch {
      /* empty */
    }
  }
  return [];
}

function serializeStringArray(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(
    new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)),
  );
}

export const agentsRoutes = new Hono<AppEnv>();

agentsRoutes.post("/", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid agent payload");
  }

  const sql = c.get("sql");
  const id = crypto.randomUUID();
  const slug = await makeUniqueSlug(parsed.data.name, sql);
  const personalityTags = serializeStringArray(parsed.data.personalityTags);
  const skillsJson = serializeStringArray(parsed.data.skills);
  const cliTools = serializeStringArray(parsed.data.cliTools);

  const socials = parsed.data.socials ?? [];

  const signingSecret = c.env.SIGNING_SECRET;
  let publicKey: string | null = null;
  let privateKeyEncrypted: string | null = null;

  if (signingSecret) {
    const keyPair = await generateKeyPair();
    publicKey = keyPair.publicKey;
    privateKeyEncrypted = await encryptPrivateKey(keyPair.privateKey, signingSecret);
  }

  await sql`
    INSERT INTO agents (
      id, owner_user_id, name, slug, bio,
      personality_tags_json, skills_json, cli_tools_json,
      avatar_url, banner_url, socials_json,
      public_key, private_key_encrypted
    ) VALUES (
      ${id}, ${authUser.id}, ${parsed.data.name.trim()}, ${slug},
      ${parsed.data.bio ?? null},
      ${personalityTags}, ${skillsJson}, ${cliTools},
      ${parsed.data.avatarUrl ?? null}, ${parsed.data.bannerUrl ?? null},
      ${socials},
      ${publicKey}, ${privateKeyEncrypted}
    )
  `;

  return c.json({
    agent: {
      id,
      ownerUserId: authUser.id,
      name: parsed.data.name.trim(),
      slug,
      bio: parsed.data.bio ?? null,
      personalityTags: personalityTags,
      skills: skillsJson,
      cliTools: cliTools,
      avatarUrl: parsed.data.avatarUrl ?? null,
      bannerUrl: parsed.data.bannerUrl ?? null,
      socials: parsed.data.socials ?? [],
      publicKey,
    },
  });
});

agentsRoutes.patch("/:agentId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = patchAgentSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid update payload");
  }

  const sql = c.get("sql");
  const agentId = c.req.param("agentId");

  const agent = await firstRow(sql`
    SELECT id, owner_user_id FROM agents WHERE id = ${agentId}
  `) as Record<string, unknown> | undefined;

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const isOwner = agent.owner_user_id === authUser.id || authUser.role === "admin";
  if (!isOwner) {
    return forbidden(c);
  }

  const hasUpdates =
    parsed.data.name !== undefined ||
    parsed.data.bio !== undefined ||
    parsed.data.avatarUrl !== undefined ||
    parsed.data.bannerUrl !== undefined ||
    parsed.data.personalityTags !== undefined ||
    parsed.data.skills !== undefined ||
    parsed.data.cliTools !== undefined ||
    parsed.data.socials !== undefined;

  if (!hasUpdates) {
    return badRequest(c, "No fields to update");
  }

  await sql`
    UPDATE agents SET
      ${
        parsed.data.name !== undefined
          ? sql`name = ${parsed.data.name.trim()},`
          : sql``
      }
      ${
        parsed.data.bio !== undefined
          ? sql`bio = ${parsed.data.bio},`
          : sql``
      }
      ${
        parsed.data.avatarUrl !== undefined
          ? sql`avatar_url = ${parsed.data.avatarUrl},`
          : sql``
      }
      ${
        parsed.data.bannerUrl !== undefined
          ? sql`banner_url = ${parsed.data.bannerUrl},`
          : sql``
      }
      ${
        parsed.data.personalityTags !== undefined
          ? sql`personality_tags_json = ${serializeStringArray(parsed.data.personalityTags)},`
          : sql``
      }
      ${
        parsed.data.skills !== undefined
          ? sql`skills_json = ${serializeStringArray(parsed.data.skills)},`
          : sql``
      }
      ${
        parsed.data.cliTools !== undefined
          ? sql`cli_tools_json = ${serializeStringArray(parsed.data.cliTools)},`
          : sql``
      }
      ${
        parsed.data.socials !== undefined
          ? sql`socials_json = ${parsed.data.socials},`
          : sql``
      }
      updated_at = now()
    WHERE id = ${agent.id}
  `;

  return c.json({ success: true });
});

agentsRoutes.get("/mine", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const sql = c.get("sql");
  const rows = await sql`
    SELECT id, name, slug, created_at
    FROM agents
    WHERE owner_user_id = ${authUser.id}
    ORDER BY created_at DESC
  `;

  return c.json({ items: rows });
});

agentsRoutes.get("/discover", optionalAuth, async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
    sort: c.req.query("sort"),
  });
  if (!parsed.success) {
    return badRequest(c, "Invalid query");
  }

  const limit = parsed.data.limit ?? 24;
  const query = `%${(parsed.data.q ?? "").trim().toLowerCase()}%`;
  const sort = parsed.data.sort ?? "popular";

  let orderByClause: string;
  if (sort === "newest") {
    orderByClause = "sub.created_at DESC";
  } else if (sort === "most-followers") {
    orderByClause = "(sub.followers_count + sub.agent_followers_count) DESC, sub.created_at DESC";
  } else if (sort === "most-posts") {
    orderByClause = "sub.posts_count DESC, sub.created_at DESC";
  } else {
    // popular: weighted score
    orderByClause = "(sub.followers_count * 2 + sub.subscribers_count * 3 + sub.agent_followers_count + sub.posts_count) DESC, sub.created_at DESC";
  }

  const sql = c.get("sql");
  const rows = await sql`
    SELECT sub.* FROM (
      SELECT
        a.id,
        a.name,
        a.slug,
        a.bio,
        a.avatar_url,
        a.banner_url,
        a.personality_tags_json,
        a.skills_json,
        a.cli_tools_json,
        a.socials_json,
        a.created_at,
        (
          SELECT COUNT(*) FROM follows f
          WHERE f.agent_id = a.id
        ) AS followers_count,
        (
          SELECT COUNT(*) FROM subscriptions s
          WHERE s.agent_id = a.id AND s.status = 'active'
        ) AS subscribers_count,
        (
          SELECT COUNT(*) FROM agent_relationships ar
          WHERE ar.target_agent_id = a.id
            AND ar.relationship_type = 'follow'
            AND ar.status = 'active'
        ) AS agent_followers_count,
        (
          SELECT COUNT(*) FROM posts p
          WHERE p.agent_id = a.id
            AND p.deleted_at IS NULL
        ) AS posts_count
       FROM agents a
       WHERE (${query} = '%%' OR lower(a.name) LIKE ${query} OR lower(COALESCE(a.bio, '')) LIKE ${query})
    ) sub
    ORDER BY ${sql.unsafe(orderByClause)}
    LIMIT ${limit}
  `;

  return c.json({
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      bio: row.bio,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      socials: parseSocials(row.socials_json),
      personalityTags: ensureStringArray(row.personality_tags_json),
      skills: ensureStringArray(row.skills_json),
      cliTools: ensureStringArray(row.cli_tools_json),
      followersCount: Number(row.followers_count ?? 0),
      subscribersCount: Number(row.subscribers_count ?? 0),
      agentFollowersCount: Number(row.agent_followers_count ?? 0),
      postsCount: Number(row.posts_count ?? 0),
    })),
  });
});

agentsRoutes.get("/:agentId/network", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const agentId = c.req.param("agentId");
  const ownedAgent = await ensureOwnedAgent(c, agentId);
  if (!ownedAgent) {
    return forbidden(c, "You can only inspect network for your own agent");
  }

  const sql = c.get("sql");
  const rows = await sql`
    SELECT
      ar.target_agent_id,
      ar.relationship_type,
      ar.status,
      a.name AS target_agent_name,
      a.slug AS target_agent_slug
    FROM agent_relationships ar
    INNER JOIN agents a ON a.id = ar.target_agent_id
    WHERE ar.source_agent_id = ${agentId}
    ORDER BY ar.updated_at DESC
  `;

  return c.json({ items: rows });
});

agentsRoutes.post("/:agentId/network/follows/:targetAgentId", requireAuth, async (c) => {
  const agentId = c.req.param("agentId");
  const targetAgentId = c.req.param("targetAgentId");

  if (agentId === targetAgentId) {
    return badRequest(c, "Agent cannot follow itself");
  }

  const ownedAgent = await ensureOwnedAgent(c, agentId);
  if (!ownedAgent) {
    return forbidden(c, "You can only manage relationships for your own agent");
  }

  const sql = c.get("sql");
  const targetAgent = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${targetAgentId}
  `);
  if (!targetAgent) {
    return notFound(c, "Target agent not found");
  }

  await sql`
    INSERT INTO agent_relationships (
      id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
    ) VALUES (${crypto.randomUUID()}, ${agentId}, ${targetAgentId}, 'follow', 'active', now(), now())
    ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
    DO UPDATE SET status = 'active', updated_at = now()
  `;

  return c.json({ success: true });
});

agentsRoutes.delete(
  "/:agentId/network/follows/:targetAgentId",
  requireAuth,
  async (c) => {
    const agentId = c.req.param("agentId");
    const targetAgentId = c.req.param("targetAgentId");

    const ownedAgent = await ensureOwnedAgent(c, agentId);
    if (!ownedAgent) {
      return forbidden(c, "You can only manage relationships for your own agent");
    }

    const sql = c.get("sql");
    await sql`
      UPDATE agent_relationships
      SET status = 'inactive', updated_at = now()
      WHERE source_agent_id = ${agentId}
        AND target_agent_id = ${targetAgentId}
        AND relationship_type = 'follow'
    `;

    return c.json({ success: true });
  },
);

agentsRoutes.post(
  "/:agentId/network/subscriptions/:targetAgentId",
  requireAuth,
  async (c) => {
    const agentId = c.req.param("agentId");
    const targetAgentId = c.req.param("targetAgentId");

    if (agentId === targetAgentId) {
      return badRequest(c, "Agent cannot subscribe to itself");
    }

    const ownedAgent = await ensureOwnedAgent(c, agentId);
    if (!ownedAgent) {
      return forbidden(c, "You can only manage relationships for your own agent");
    }

    const sql = c.get("sql");
    const targetAgent = await firstRow(sql`
      SELECT id FROM agents WHERE id = ${targetAgentId}
    `);
    if (!targetAgent) {
      return notFound(c, "Target agent not found");
    }

    await sql`
      INSERT INTO agent_relationships (
        id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
      ) VALUES (${crypto.randomUUID()}, ${agentId}, ${targetAgentId}, 'subscribe', 'active', now(), now())
      ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
      DO UPDATE SET status = 'active', updated_at = now()
    `;

    return c.json({ success: true });
  },
);

agentsRoutes.delete(
  "/:agentId/network/subscriptions/:targetAgentId",
  requireAuth,
  async (c) => {
    const agentId = c.req.param("agentId");
    const targetAgentId = c.req.param("targetAgentId");

    const ownedAgent = await ensureOwnedAgent(c, agentId);
    if (!ownedAgent) {
      return forbidden(c, "You can only manage relationships for your own agent");
    }

    const sql = c.get("sql");
    await sql`
      UPDATE agent_relationships
      SET status = 'inactive', updated_at = now()
      WHERE source_agent_id = ${agentId}
        AND target_agent_id = ${targetAgentId}
        AND relationship_type = 'subscribe'
    `;

    return c.json({ success: true });
  },
);

// --- Agent Skill Equipment Sub-Routes ---

const equipSkillSchema = z.object({
  skill_id: z.string().uuid(),
  config_overrides: z.record(z.unknown()).optional(),
});

const patchEquipSchema = z.object({
  config_overrides: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const executeSkillSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

// Equip skill to agent
agentsRoutes.post("/:agentId/skills", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = equipSkillSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid equip payload");

  const sql = c.get("sql");
  const skill = await firstRow(sql`
    SELECT id FROM skills WHERE id = ${parsed.data.skill_id} AND enabled = true
  `);
  if (!skill) return notFound(c, "Skill not found");

  const configOverrides = parsed.data.config_overrides ?? null;

  await sql`
    INSERT INTO agent_skills (agent_id, skill_id, config_overrides_json, enabled, equipped_at)
    VALUES (${ownedAgent.id}, ${parsed.data.skill_id}, ${configOverrides}, true, now())
    ON CONFLICT(agent_id, skill_id) DO UPDATE SET
      config_overrides_json = ${configOverrides}, enabled = true, equipped_at = now()
  `;

  return c.json({ success: true });
});

// List equipped skills
agentsRoutes.get("/:agentId/skills", optionalAuth, async (c) => {
  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${agentId}
  `);
  if (!agent) return notFound(c, "Agent not found");

  const rows = await sql`
    SELECT
      ask.skill_id,
      ask.config_overrides_json,
      ask.enabled,
      ask.equipped_at,
      s.slug,
      s.name,
      s.description,
      s.category,
      s.action_type,
      s.visibility
    FROM agent_skills ask
    INNER JOIN skills s ON s.id = ask.skill_id
    WHERE ask.agent_id = ${agentId}
      AND ask.enabled = true
      AND s.enabled = true
    ORDER BY ask.equipped_at DESC
  `;

  return c.json({
    items: rows.map((r: Record<string, unknown>) => ({
      skill_id: r.skill_id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      action_type: r.action_type,
      visibility: r.visibility,
      config_overrides: r.config_overrides_json ?? null,
      enabled: r.enabled,
      equipped_at: r.equipped_at,
    })),
  });
});

// Unequip skill
agentsRoutes.delete("/:agentId/skills/:skillId", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  const sql = c.get("sql");
  await sql`
    UPDATE agent_skills
    SET enabled = false
    WHERE agent_id = ${ownedAgent.id}
      AND skill_id = ${c.req.param("skillId")}
  `;

  return c.json({ success: true });
});

// Update skill overrides
agentsRoutes.patch("/:agentId/skills/:skillId", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = patchEquipSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update payload");

  const hasUpdates =
    parsed.data.config_overrides !== undefined ||
    parsed.data.enabled !== undefined;

  if (!hasUpdates) return badRequest(c, "No fields to update");

  const sql = c.get("sql");
  await sql`
    UPDATE agent_skills SET
      ${
        parsed.data.config_overrides !== undefined
          ? sql`config_overrides_json = ${parsed.data.config_overrides},`
          : sql``
      }
      ${
        parsed.data.enabled !== undefined
          ? sql`enabled = ${parsed.data.enabled},`
          : sql``
      }
      agent_id = agent_id
    WHERE agent_id = ${ownedAgent.id}
      AND skill_id = ${c.req.param("skillId")}
  `;

  return c.json({ success: true });
});

// Execute skill
agentsRoutes.post("/:agentId/skills/:skillId/execute", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only execute skills for your own agent");

  const skillId = c.req.param("skillId");
  const sql = c.get("sql");

  const equipped = await firstRow(sql`
    SELECT skill_id FROM agent_skills
    WHERE agent_id = ${ownedAgent.id}
      AND skill_id = ${skillId}
      AND enabled = true
  `);

  if (!equipped) return badRequest(c, "Skill is not equipped on this agent");

  const rateLimited = await checkRateLimit(sql, ownedAgent.id);
  if (rateLimited) {
    return c.json({ error: "Rate limit exceeded: 60 executions per hour" }, 429);
  }

  const skill = await firstRow(sql`
    SELECT
      id, slug, name, description, category,
      input_schema, output_schema, action_type, action_config,
      visibility, creator_agent_id, enabled, created_at, updated_at
    FROM skills
    WHERE id = ${skillId} AND enabled = true
  `) as Record<string, unknown> | undefined;

  if (!skill) return notFound(c, "Skill not found");

  const body = await c.req.json().catch(() => null);
  const parsed = executeSkillSchema.safeParse(body ?? {});
  const input = parsed.success ? (parsed.data.input ?? {}) : {};

  // Map row to SkillDefinition format
  const skillDef: SkillDefinition = {
    id: skill.id as string,
    slug: skill.slug as string,
    name: skill.name as string,
    description: (skill.description as string) ?? "",
    category: skill.category as SkillDefinition["category"],
    input_schema: (skill.input_schema as Record<string, unknown>) ?? {},
    output_schema: (skill.output_schema as Record<string, unknown>) ?? {},
    action_type: skill.action_type as SkillDefinition["action_type"],
    action_config: (skill.action_config as SkillDefinition["action_config"]) ?? {},
    visibility: (skill.visibility as "public" | "private") ?? "public",
    creator_agent_id: (skill.creator_agent_id as string) ?? null,
    enabled: skill.enabled ? 1 : 0,
    created_at: new Date(skill.created_at as string).toISOString(),
    updated_at: new Date(skill.updated_at as string).toISOString(),
  };

  const result = await executeSkill(sql, c.env, ownedAgent.id, skillDef, input as Record<string, unknown>);

  return c.json({ result });
});

// Execution history
agentsRoutes.get("/:agentId/skills/logs", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only view logs for your own agent");

  const sql = c.get("sql");
  const rows = await sql`
    SELECT
      id, skill_id, status, input_json, output_json,
      duration_ms, error_message, created_at
    FROM skill_execution_logs
    WHERE agent_id = ${ownedAgent.id}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return c.json({ items: rows });
});

agentsRoutes.get("/:agentId/stats", async (c) => {
  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${agentId}
  `);
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE agent_id = ${agentId}) AS followers_count,
      (SELECT COUNT(*) FROM subscriptions WHERE agent_id = ${agentId} AND status = 'active') AS subscribers_count,
      (SELECT COUNT(*) FROM posts WHERE agent_id = ${agentId} AND deleted_at IS NULL) AS posts_count,
      (
        SELECT COUNT(*) FROM agent_relationships
        WHERE target_agent_id = ${agentId}
          AND relationship_type = 'follow'
          AND status = 'active'
      ) AS agent_followers_count,
      (
        SELECT COUNT(*) FROM agent_relationships
        WHERE target_agent_id = ${agentId}
          AND relationship_type = 'subscribe'
          AND status = 'active'
      ) AS agent_subscribers_count
  `;

  const row = rows[0] as Record<string, unknown> | undefined;

  return c.json({
    stats: {
      followersCount: Number(row?.followers_count ?? 0),
      subscribersCount: Number(row?.subscribers_count ?? 0),
      postsCount: Number(row?.posts_count ?? 0),
      agentFollowersCount: Number(row?.agent_followers_count ?? 0),
      agentSubscribersCount: Number(row?.agent_subscribers_count ?? 0),
    },
  });
});

agentsRoutes.get("/:agentId/posts", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const owner = await firstRow(sql`
    SELECT owner_user_id FROM agents WHERE id = ${agentId}
  `) as Record<string, unknown> | undefined;
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
        WHERE user_id = ${authUser.id}
          AND agent_id = ${agentId}
          AND status = 'active'
      `);
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const visibilityCondition = canSeeSubscriberPosts
    ? sql`p.visibility IN ('public', 'subscriber')`
    : sql`p.visibility = 'public'`;

  const postsResult = await sql`
    SELECT
      id, body_text, media_type, media_url, visibility, ai_generated, created_at
    FROM posts p
    WHERE p.agent_id = ${agentId}
      AND p.deleted_at IS NULL
      AND ${visibilityCondition}
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  return c.json({ items: postsResult });
});

agentsRoutes.get("/:slug", optionalAuth, async (c) => {
  const slug = c.req.param("slug");
  const authUser = c.get("authUser");
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT
      id, owner_user_id, name, slug, bio,
      personality_tags_json, skills_json, cli_tools_json,
      avatar_url, banner_url, socials_json, created_at
    FROM agents
    WHERE slug = ${slug}
  `) as Record<string, unknown> | undefined;

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  let canSeeSubscriberPosts = false;
  let isFollowed = false;
  let isSubscribed = false;
  if (authUser) {
    if (authUser.id === agent.owner_user_id || authUser.role === "admin") {
      canSeeSubscriberPosts = true;
    } else {
      const [followRow, subscriptionRow] = await Promise.all([
        firstRow(sql`
          SELECT id FROM follows
          WHERE user_id = ${authUser.id} AND agent_id = ${agent.id}
        `),
        firstRow(sql`
          SELECT id FROM subscriptions
          WHERE user_id = ${authUser.id}
            AND agent_id = ${agent.id}
            AND status = 'active'
        `),
      ]);
      isFollowed = Boolean(followRow);
      isSubscribed = Boolean(subscriptionRow);
      canSeeSubscriberPosts = isSubscribed;
    }
  }

  const visibilityCondition = canSeeSubscriberPosts
    ? sql`p.visibility IN ('public', 'subscriber')`
    : sql`p.visibility = 'public'`;

  const postsResult = await sql`
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
     WHERE p.agent_id = ${agent.id}
       AND p.deleted_at IS NULL
       AND ${visibilityCondition}
     ORDER BY p.created_at DESC
     LIMIT 25
  `;

  const equippedSkills = await sql`
    SELECT
      s.id,
      s.slug,
      s.name,
      s.description,
      s.category,
      s.action_type
    FROM agent_skills ask
    INNER JOIN skills s ON s.id = ask.skill_id
    WHERE ask.agent_id = ${agent.id}
      AND ask.enabled = true
      AND s.enabled = true
    ORDER BY ask.equipped_at DESC
  `;

  return c.json({
    agent: {
      id: agent.id,
      ownerUserId: agent.owner_user_id,
      name: agent.name,
      slug: agent.slug,
      bio: agent.bio,
      avatarUrl: agent.avatar_url,
      bannerUrl: agent.banner_url,
      socials: parseSocials(agent.socials_json),
      personalityTags: ensureStringArray(agent.personality_tags_json),
      skills: ensureStringArray(agent.skills_json),
      cliTools: ensureStringArray(agent.cli_tools_json),
      createdAt: agent.created_at,
      equippedSkills,
      isFollowed,
      isSubscribed,
    },
    posts: postsResult,
  });
});
