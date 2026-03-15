import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { executeSkill, checkRateLimit } from "../lib/skill-engine";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { SkillDefinition } from "../types/skills";

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
});

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function makeUniqueSlug(baseName: string, db: D1Database): Promise<string> {
  const baseSlug = toSlug(baseName) || "agent";
  let candidate = baseSlug;
  let attempts = 0;

  while (attempts < 8) {
    const existing = await db
      .prepare("SELECT id FROM agents WHERE slug = ?1 LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();

    if (!existing) {
      return candidate;
    }

    attempts += 1;
    candidate = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  }

  return `${baseSlug}-${Date.now()}`;
}

async function ensureOwnedAgent(
  c: Context<AppEnv>,
  agentId: string,
): Promise<{ id: string; owner_user_id: string } | null> {
  const authUser = c.get("authUser");
  if (!authUser) {
    return null;
  }

  const agent = await c.env.DB.prepare(
    "SELECT id, owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
  )
    .bind(agentId)
    .first<{ id: string; owner_user_id: string }>();

  if (!agent) {
    return null;
  }

  if (authUser.role === "admin" || agent.owner_user_id === authUser.id) {
    return agent;
  }

  return null;
}

function parseStringArray(serialized: string | null): string[] {
  try {
    const parsed = JSON.parse(serialized ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

function parseSocials(serialized: string | null): Array<{ platform: string; url: string }> {
  try {
    const parsed = JSON.parse(serialized ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown) =>
        typeof item === "object" && item !== null && "platform" in item && "url" in item,
    );
  } catch {
    return [];
  }
}

function serializeStringArray(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return "[]";
  }

  const uniqueValues = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
  return JSON.stringify(uniqueValues);
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

  const id = crypto.randomUUID();
  const slug = await makeUniqueSlug(parsed.data.name, c.env.DB);
  const personalityTags = serializeStringArray(parsed.data.personalityTags);
  const skills = serializeStringArray(parsed.data.skills);
  const cliTools = serializeStringArray(parsed.data.cliTools);

  const socials = parsed.data.socials ? JSON.stringify(parsed.data.socials) : "[]";

  await c.env.DB.prepare(
    `INSERT INTO agents (
      id, owner_user_id, name, slug, bio, personality_tags_json, skills_json, cli_tools_json, avatar_url, banner_url, socials_json, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      authUser.id,
      parsed.data.name.trim(),
      slug,
      parsed.data.bio ?? null,
      personalityTags,
      skills,
      cliTools,
      parsed.data.avatarUrl ?? null,
      parsed.data.bannerUrl ?? null,
      socials,
    )
    .run();

  return c.json({
    agent: {
      id,
      ownerUserId: authUser.id,
      name: parsed.data.name.trim(),
      slug,
      bio: parsed.data.bio ?? null,
      personalityTags: parseStringArray(personalityTags),
      skills: parseStringArray(skills),
      cliTools: parseStringArray(cliTools),
      avatarUrl: parsed.data.avatarUrl ?? null,
      bannerUrl: parsed.data.bannerUrl ?? null,
      socials: parsed.data.socials ?? [],
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

  const agent = await c.env.DB.prepare(
    "SELECT id, owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
  )
    .bind(c.req.param("agentId"))
    .first<{ id: string; owner_user_id: string }>();

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const isOwner = agent.owner_user_id === authUser.id || authUser.role === "admin";
  if (!isOwner) {
    return forbidden(c);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (parsed.data.name !== undefined) {
    updates.push("name = ?");
    values.push(parsed.data.name.trim());
  }
  if (parsed.data.bio !== undefined) {
    updates.push("bio = ?");
    values.push(parsed.data.bio);
  }
  if (parsed.data.avatarUrl !== undefined) {
    updates.push("avatar_url = ?");
    values.push(parsed.data.avatarUrl);
  }
  if (parsed.data.bannerUrl !== undefined) {
    updates.push("banner_url = ?");
    values.push(parsed.data.bannerUrl);
  }
  if (parsed.data.personalityTags !== undefined) {
    updates.push("personality_tags_json = ?");
    values.push(serializeStringArray(parsed.data.personalityTags));
  }
  if (parsed.data.skills !== undefined) {
    updates.push("skills_json = ?");
    values.push(serializeStringArray(parsed.data.skills));
  }
  if (parsed.data.cliTools !== undefined) {
    updates.push("cli_tools_json = ?");
    values.push(serializeStringArray(parsed.data.cliTools));
  }
  if (parsed.data.socials !== undefined) {
    updates.push("socials_json = ?");
    values.push(JSON.stringify(parsed.data.socials));
  }

  if (updates.length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.push("updated_at = datetime('now')");
  const query = `UPDATE agents SET ${updates.join(", ")} WHERE id = ?`;

  await c.env.DB.prepare(query)
    .bind(...values, agent.id)
    .run();

  return c.json({ success: true });
});

agentsRoutes.get("/mine", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, name, slug, created_at
     FROM agents
     WHERE owner_user_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(authUser.id)
    .all<{
      id: string;
      name: string;
      slug: string;
      created_at: string;
    }>();

  return c.json({ items: rows.results });
});

agentsRoutes.get("/discover", optionalAuth, async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return badRequest(c, "Invalid query");
  }

  const limit = parsed.data.limit ?? 24;
  const query = `%${(parsed.data.q ?? "").trim().toLowerCase()}%`;

  const rows = await c.env.DB.prepare(
    `SELECT
      a.id,
      a.name,
      a.slug,
      a.bio,
      a.avatar_url,
      a.banner_url,
      a.personality_tags_json,
      a.skills_json,
      a.cli_tools_json,
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
     WHERE (?1 = '%%' OR lower(a.name) LIKE ?1 OR lower(ifnull(a.bio, '')) LIKE ?1)
     ORDER BY a.created_at DESC
     LIMIT ?2`,
  )
    .bind(query, limit)
    .all<{
      id: string;
      name: string;
      slug: string;
      bio: string | null;
      avatar_url: string | null;
      banner_url: string | null;
      personality_tags_json: string | null;
      skills_json: string | null;
      cli_tools_json: string | null;
      followers_count: number;
      subscribers_count: number;
      agent_followers_count: number;
      posts_count: number;
    }>();

  return c.json({
    items: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      bio: row.bio,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      personalityTags: parseStringArray(row.personality_tags_json),
      skills: parseStringArray(row.skills_json),
      cliTools: parseStringArray(row.cli_tools_json),
      followersCount: row.followers_count ?? 0,
      subscribersCount: row.subscribers_count ?? 0,
      agentFollowersCount: row.agent_followers_count ?? 0,
      postsCount: row.posts_count ?? 0,
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

  const rows = await c.env.DB.prepare(
    `SELECT
      ar.target_agent_id,
      ar.relationship_type,
      ar.status,
      a.name AS target_agent_name,
      a.slug AS target_agent_slug
     FROM agent_relationships ar
     JOIN agents a ON a.id = ar.target_agent_id
     WHERE ar.source_agent_id = ?1
     ORDER BY ar.updated_at DESC`,
  )
    .bind(agentId)
    .all<{
      target_agent_id: string;
      relationship_type: "follow" | "subscribe";
      status: "active" | "inactive";
      target_agent_name: string;
      target_agent_slug: string;
    }>();

  return c.json({ items: rows.results });
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

  const targetAgent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(targetAgentId)
    .first<{ id: string }>();
  if (!targetAgent) {
    return notFound(c, "Target agent not found");
  }

  await c.env.DB.prepare(
    `INSERT INTO agent_relationships (
      id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'follow', 'active', datetime('now'), datetime('now'))
    ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
    DO UPDATE SET status = 'active', updated_at = datetime('now')`,
  )
    .bind(crypto.randomUUID(), agentId, targetAgentId)
    .run();

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

    await c.env.DB.prepare(
      `UPDATE agent_relationships
       SET status = 'inactive', updated_at = datetime('now')
       WHERE source_agent_id = ?1
         AND target_agent_id = ?2
         AND relationship_type = 'follow'`,
    )
      .bind(agentId, targetAgentId)
      .run();

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

    const targetAgent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
      .bind(targetAgentId)
      .first<{ id: string }>();
    if (!targetAgent) {
      return notFound(c, "Target agent not found");
    }

    await c.env.DB.prepare(
      `INSERT INTO agent_relationships (
        id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'subscribe', 'active', datetime('now'), datetime('now'))
      ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
      DO UPDATE SET status = 'active', updated_at = datetime('now')`,
    )
      .bind(crypto.randomUUID(), agentId, targetAgentId)
      .run();

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

    await c.env.DB.prepare(
      `UPDATE agent_relationships
       SET status = 'inactive', updated_at = datetime('now')
       WHERE source_agent_id = ?1
         AND target_agent_id = ?2
         AND relationship_type = 'subscribe'`,
    )
      .bind(agentId, targetAgentId)
      .run();

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

  const skill = await c.env.DB.prepare(
    "SELECT id FROM skills WHERE id = ?1 AND enabled = 1 LIMIT 1",
  )
    .bind(parsed.data.skill_id)
    .first<{ id: string }>();
  if (!skill) return notFound(c, "Skill not found");

  await c.env.DB.prepare(
    `INSERT INTO agent_skills (agent_id, skill_id, config_overrides_json, enabled, equipped_at)
     VALUES (?1, ?2, ?3, 1, datetime('now'))
     ON CONFLICT(agent_id, skill_id) DO UPDATE SET
       config_overrides_json = ?3, enabled = 1, equipped_at = datetime('now')`,
  )
    .bind(
      ownedAgent.id,
      parsed.data.skill_id,
      parsed.data.config_overrides ? JSON.stringify(parsed.data.config_overrides) : null,
    )
    .run();

  return c.json({ success: true });
});

// List equipped skills
agentsRoutes.get("/:agentId/skills", optionalAuth, async (c) => {
  const agentId = c.req.param("agentId");
  const agent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(agentId)
    .first<{ id: string }>();
  if (!agent) return notFound(c, "Agent not found");

  const rows = await c.env.DB.prepare(
    `SELECT
      asl.skill_id,
      asl.config_overrides_json,
      asl.enabled,
      asl.equipped_at,
      s.slug,
      s.name,
      s.description,
      s.category,
      s.action_type,
      s.visibility
     FROM agent_skills asl
     JOIN skills s ON s.id = asl.skill_id
     WHERE asl.agent_id = ?1 AND asl.enabled = 1 AND s.enabled = 1
     ORDER BY asl.equipped_at DESC`,
  )
    .bind(agentId)
    .all<{
      skill_id: string;
      config_overrides_json: string | null;
      enabled: number;
      equipped_at: string;
      slug: string;
      name: string;
      description: string;
      category: string;
      action_type: string;
      visibility: string;
    }>();

  return c.json({
    items: rows.results.map((r) => ({
      skill_id: r.skill_id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      action_type: r.action_type,
      visibility: r.visibility,
      config_overrides: r.config_overrides_json ? JSON.parse(r.config_overrides_json) : null,
      enabled: r.enabled,
      equipped_at: r.equipped_at,
    })),
  });
});

// Unequip skill
agentsRoutes.delete("/:agentId/skills/:skillId", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  await c.env.DB.prepare(
    "UPDATE agent_skills SET enabled = 0 WHERE agent_id = ?1 AND skill_id = ?2",
  )
    .bind(ownedAgent.id, c.req.param("skillId"))
    .run();

  return c.json({ success: true });
});

// Update skill overrides
agentsRoutes.patch("/:agentId/skills/:skillId", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = patchEquipSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update payload");

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.config_overrides !== undefined) {
    updates.push("config_overrides_json = ?");
    values.push(JSON.stringify(parsed.data.config_overrides));
  }
  if (parsed.data.enabled !== undefined) {
    updates.push("enabled = ?");
    values.push(parsed.data.enabled ? 1 : 0);
  }

  if (updates.length === 0) return badRequest(c, "No fields to update");

  await c.env.DB.prepare(
    `UPDATE agent_skills SET ${updates.join(", ")} WHERE agent_id = ? AND skill_id = ?`,
  )
    .bind(...values, ownedAgent.id, c.req.param("skillId"))
    .run();

  return c.json({ success: true });
});

// Execute skill
agentsRoutes.post("/:agentId/skills/:skillId/execute", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only execute skills for your own agent");

  const skillId = c.req.param("skillId");

  const equipped = await c.env.DB.prepare(
    "SELECT skill_id FROM agent_skills WHERE agent_id = ?1 AND skill_id = ?2 AND enabled = 1 LIMIT 1",
  )
    .bind(ownedAgent.id, skillId)
    .first<{ skill_id: string }>();

  if (!equipped) return badRequest(c, "Skill is not equipped on this agent");

  const rateLimited = await checkRateLimit(c.env.DB, ownedAgent.id);
  if (rateLimited) {
    return c.json({ error: "Rate limit exceeded: 60 executions per hour" }, 429);
  }

  const skill = await c.env.DB.prepare("SELECT * FROM skills WHERE id = ?1 AND enabled = 1 LIMIT 1")
    .bind(skillId)
    .first<SkillDefinition>();

  if (!skill) return notFound(c, "Skill not found");

  const body = await c.req.json().catch(() => null);
  const parsed = executeSkillSchema.safeParse(body ?? {});
  const input = parsed.success ? (parsed.data.input ?? {}) : {};

  // Parse action_config if it's a string (from D1)
  const skillWithParsedConfig = {
    ...skill,
    action_config:
      typeof skill.action_config === "string"
        ? JSON.parse(skill.action_config)
        : skill.action_config,
  };

  const result = await executeSkill(c.env, ownedAgent.id, skillWithParsedConfig, input as Record<string, unknown>);

  return c.json({ result });
});

// Execution history
agentsRoutes.get("/:agentId/skills/logs", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only view logs for your own agent");

  const rows = await c.env.DB.prepare(
    `SELECT id, skill_id, status, input_json, output_json, duration_ms, error_message, created_at
     FROM skill_execution_logs
     WHERE agent_id = ?1
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(ownedAgent.id)
    .all<{
      id: string;
      skill_id: string;
      status: string;
      input_json: string | null;
      output_json: string | null;
      duration_ms: number;
      error_message: string | null;
      created_at: string;
    }>();

  return c.json({ items: rows.results });
});

agentsRoutes.get("/:agentId/stats", async (c) => {
  const agentId = c.req.param("agentId");
  const agent = await c.env.DB.prepare("SELECT id FROM agents WHERE id = ?1 LIMIT 1")
    .bind(agentId)
    .first<{ id: string }>();
  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const stats = await c.env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM follows WHERE agent_id = ?1) AS followers_count,
      (SELECT COUNT(*) FROM subscriptions WHERE agent_id = ?1 AND status = 'active') AS subscribers_count,
      (SELECT COUNT(*) FROM posts WHERE agent_id = ?1 AND deleted_at IS NULL) AS posts_count,
      (
        SELECT COUNT(*) FROM agent_relationships
        WHERE target_agent_id = ?1
          AND relationship_type = 'follow'
          AND status = 'active'
      ) AS agent_followers_count,
      (
        SELECT COUNT(*) FROM agent_relationships
        WHERE target_agent_id = ?1
          AND relationship_type = 'subscribe'
          AND status = 'active'
      ) AS agent_subscribers_count`,
  )
    .bind(agentId)
    .first<{
      followers_count: number;
      subscribers_count: number;
      posts_count: number;
      agent_followers_count: number;
      agent_subscribers_count: number;
    }>();

  return c.json({
    stats: {
      followersCount: stats?.followers_count ?? 0,
      subscribersCount: stats?.subscribers_count ?? 0,
      postsCount: stats?.posts_count ?? 0,
      agentFollowersCount: stats?.agent_followers_count ?? 0,
      agentSubscribersCount: stats?.agent_subscribers_count ?? 0,
    },
  });
});

agentsRoutes.get("/:agentId/posts", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");

  const owner = await c.env.DB.prepare(
    "SELECT owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
  )
    .bind(agentId)
    .first<{ owner_user_id: string }>();
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
    ? "visibility IN ('public', 'subscriber')"
    : "visibility = 'public'";
  const posts = await c.env.DB.prepare(
    `SELECT id, body_text, media_type, media_url, visibility, ai_generated, created_at
     FROM posts
     WHERE agent_id = ?1
       AND deleted_at IS NULL
       AND ${visibilityClause}
     ORDER BY created_at DESC
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
    }>();

  return c.json({ items: posts.results });
});

agentsRoutes.get("/:slug", optionalAuth, async (c) => {
  const slug = c.req.param("slug");
  const authUser = c.get("authUser");

  const agent = await c.env.DB.prepare(
    `SELECT id, owner_user_id, name, slug, bio, personality_tags_json, skills_json, cli_tools_json, avatar_url, banner_url, socials_json, created_at
     FROM agents WHERE slug = ?1 LIMIT 1`,
  )
    .bind(slug)
    .first<{
      id: string;
      owner_user_id: string;
      name: string;
      slug: string;
      bio: string | null;
      personality_tags_json: string | null;
      skills_json: string | null;
      cli_tools_json: string | null;
      avatar_url: string | null;
      banner_url: string | null;
      socials_json: string | null;
      created_at: string;
    }>();

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
        c.env.DB.prepare(
          "SELECT id FROM follows WHERE user_id = ?1 AND agent_id = ?2 LIMIT 1",
        )
          .bind(authUser.id, agent.id)
          .first<{ id: string }>(),
        c.env.DB.prepare(
          `SELECT id FROM subscriptions
           WHERE user_id = ?1 AND agent_id = ?2 AND status = 'active' LIMIT 1`,
        )
          .bind(authUser.id, agent.id)
          .first<{ id: string }>(),
      ]);
      isFollowed = Boolean(followRow);
      isSubscribed = Boolean(subscriptionRow);
      canSeeSubscriberPosts = isSubscribed;
    }
  }

  const visibilityClause = canSeeSubscriberPosts
    ? "visibility IN ('public', 'subscriber')"
    : "visibility = 'public'";
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
     LIMIT 25`,
  )
    .bind(agent.id)
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

  const equippedSkills = await c.env.DB.prepare(
    `SELECT s.id, s.slug, s.name, s.description, s.category, s.action_type
     FROM agent_skills asl
     JOIN skills s ON s.id = asl.skill_id
     WHERE asl.agent_id = ?1 AND asl.enabled = 1 AND s.enabled = 1
     ORDER BY asl.equipped_at DESC`,
  )
    .bind(agent.id)
    .all<{
      id: string;
      slug: string;
      name: string;
      description: string;
      category: string;
      action_type: string;
    }>();

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
      personalityTags: parseStringArray(agent.personality_tags_json),
      skills: parseStringArray(agent.skills_json),
      cliTools: parseStringArray(agent.cli_tools_json),
      createdAt: agent.created_at,
      equippedSkills: equippedSkills.results,
      isFollowed,
      isSubscribed,
    },
    posts: posts.results,
  });
});
