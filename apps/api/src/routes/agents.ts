import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { eq, sql, and, or, desc, asc } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { executeSkill, checkRateLimit } from "../lib/skill-engine";
import { makeUniqueSlug } from "../lib/db-helpers";
import { generateKeyPair, encryptPrivateKey } from "../lib/signing";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { SkillDefinition } from "../types/skills";
import type { Database } from "../db"
import { firstRow } from "../db";
import {
  agents,
  posts,
  follows,
  subscriptions,
  agentRelationships,
  skills,
  agentSkills,
  skillExecutionLogs,
} from "../db/schema";

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

  const db = c.get("db");
  const agent = await firstRow(db
    .select({
      id: agents.id,
      ownerUserId: agents.ownerUserId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
  );

  if (!agent) {
    return null;
  }

  if (authUser.role === "admin" || agent.ownerUserId === authUser.id) {
    return agent;
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

  const db = c.get("db");
  const id = crypto.randomUUID();
  const slug = await makeUniqueSlug(parsed.data.name, db);
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

  await db.insert(agents).values({
    id,
    ownerUserId: authUser.id,
    name: parsed.data.name.trim(),
    slug,
    bio: parsed.data.bio ?? null,
    personalityTagsJson: personalityTags,
    skillsJson,
    cliToolsJson: cliTools,
    avatarUrl: parsed.data.avatarUrl ?? null,
    bannerUrl: parsed.data.bannerUrl ?? null,
    socialsJson: socials,
    publicKey,
    privateKeyEncrypted,
  });

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

  const db = c.get("db");
  const agentId = c.req.param("agentId");

  const agent = await firstRow(db
    .select({
      id: agents.id,
      ownerUserId: agents.ownerUserId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
  );

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const isOwner = agent.ownerUserId === authUser.id || authUser.role === "admin";
  if (!isOwner) {
    return forbidden(c);
  }

  const updates: Partial<typeof agents.$inferInsert> = {};

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name.trim();
  }
  if (parsed.data.bio !== undefined) {
    updates.bio = parsed.data.bio;
  }
  if (parsed.data.avatarUrl !== undefined) {
    updates.avatarUrl = parsed.data.avatarUrl;
  }
  if (parsed.data.bannerUrl !== undefined) {
    updates.bannerUrl = parsed.data.bannerUrl;
  }
  if (parsed.data.personalityTags !== undefined) {
    updates.personalityTagsJson = serializeStringArray(parsed.data.personalityTags);
  }
  if (parsed.data.skills !== undefined) {
    updates.skillsJson = serializeStringArray(parsed.data.skills);
  }
  if (parsed.data.cliTools !== undefined) {
    updates.cliToolsJson = serializeStringArray(parsed.data.cliTools);
  }
  if (parsed.data.socials !== undefined) {
    updates.socialsJson = parsed.data.socials;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(c, "No fields to update");
  }

  await db
    .update(agents)
    .set({ ...updates, updatedAt: sql`now()` })
    .where(eq(agents.id, agent.id));

  return c.json({ success: true });
});

agentsRoutes.get("/mine", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const db = c.get("db");
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      created_at: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.ownerUserId, authUser.id))
    .orderBy(desc(agents.createdAt));

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

  const orderByClause =
    sort === "newest"
      ? sql`sub.created_at DESC`
      : sort === "most-followers"
        ? sql`(sub.followers_count + sub.agent_followers_count) DESC, sub.created_at DESC`
        : sort === "most-posts"
          ? sql`sub.posts_count DESC, sub.created_at DESC`
          : // popular: weighted score
            sql`(sub.followers_count * 2 + sub.subscribers_count * 3 + sub.agent_followers_count + sub.posts_count) DESC, sub.created_at DESC`;

  const db = c.get("db");
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    bio: string | null;
    avatar_url: string | null;
    banner_url: string | null;
    personality_tags_json: unknown;
    skills_json: unknown;
    cli_tools_json: unknown;
    socials_json: unknown;
    followers_count: number;
    subscribers_count: number;
    agent_followers_count: number;
    posts_count: number;
  }>(sql`
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
    ORDER BY ${orderByClause}
    LIMIT ${limit}
  `);

  return c.json({
    items: rows.rows.map((row) => ({
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

  const db = c.get("db");
  const rows = await db
    .select({
      target_agent_id: agentRelationships.targetAgentId,
      relationship_type: agentRelationships.relationshipType,
      status: agentRelationships.status,
      target_agent_name: agents.name,
      target_agent_slug: agents.slug,
    })
    .from(agentRelationships)
    .innerJoin(agents, eq(agents.id, agentRelationships.targetAgentId))
    .where(eq(agentRelationships.sourceAgentId, agentId))
    .orderBy(desc(agentRelationships.updatedAt));

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

  const db = c.get("db");
  const targetAgent = await firstRow(db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, targetAgentId))
  );
  if (!targetAgent) {
    return notFound(c, "Target agent not found");
  }

  await db.execute(sql`
    INSERT INTO agent_relationships (
      id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
    ) VALUES (${crypto.randomUUID()}, ${agentId}, ${targetAgentId}, 'follow', 'active', now(), now())
    ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
    DO UPDATE SET status = 'active', updated_at = now()
  `);

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

    const db = c.get("db");
    await db
      .update(agentRelationships)
      .set({ status: "inactive", updatedAt: sql`now()` })
      .where(
        and(
          eq(agentRelationships.sourceAgentId, agentId),
          eq(agentRelationships.targetAgentId, targetAgentId),
          eq(agentRelationships.relationshipType, "follow"),
        ),
      );

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

    const db = c.get("db");
    const targetAgent = await firstRow(db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
    );
    if (!targetAgent) {
      return notFound(c, "Target agent not found");
    }

    await db.execute(sql`
      INSERT INTO agent_relationships (
        id, source_agent_id, target_agent_id, relationship_type, status, created_at, updated_at
      ) VALUES (${crypto.randomUUID()}, ${agentId}, ${targetAgentId}, 'subscribe', 'active', now(), now())
      ON CONFLICT(source_agent_id, target_agent_id, relationship_type)
      DO UPDATE SET status = 'active', updated_at = now()
    `);

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

    const db = c.get("db");
    await db
      .update(agentRelationships)
      .set({ status: "inactive", updatedAt: sql`now()` })
      .where(
        and(
          eq(agentRelationships.sourceAgentId, agentId),
          eq(agentRelationships.targetAgentId, targetAgentId),
          eq(agentRelationships.relationshipType, "subscribe"),
        ),
      );

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

  const db = c.get("db");
  const skill = await firstRow(db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.id, parsed.data.skill_id), eq(skills.enabled, true)))
  );
  if (!skill) return notFound(c, "Skill not found");

  const configOverrides = parsed.data.config_overrides ?? null;

  await db.execute(sql`
    INSERT INTO agent_skills (agent_id, skill_id, config_overrides_json, enabled, equipped_at)
    VALUES (${ownedAgent.id}, ${parsed.data.skill_id}, ${configOverrides}, true, now())
    ON CONFLICT(agent_id, skill_id) DO UPDATE SET
      config_overrides_json = ${configOverrides}, enabled = true, equipped_at = now()
  `);

  return c.json({ success: true });
});

// List equipped skills
agentsRoutes.get("/:agentId/skills", optionalAuth, async (c) => {
  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const agent = await firstRow(db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
  );
  if (!agent) return notFound(c, "Agent not found");

  const rows = await db
    .select({
      skill_id: agentSkills.skillId,
      config_overrides_json: agentSkills.configOverridesJson,
      enabled: agentSkills.enabled,
      equipped_at: agentSkills.equippedAt,
      slug: skills.slug,
      name: skills.name,
      description: skills.description,
      category: skills.category,
      action_type: skills.actionType,
      visibility: skills.visibility,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(
      and(
        eq(agentSkills.agentId, agentId),
        eq(agentSkills.enabled, true),
        eq(skills.enabled, true),
      ),
    )
    .orderBy(desc(agentSkills.equippedAt));

  return c.json({
    items: rows.map((r) => ({
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

  const db = c.get("db");
  await db
    .update(agentSkills)
    .set({ enabled: false })
    .where(
      and(
        eq(agentSkills.agentId, ownedAgent.id),
        eq(agentSkills.skillId, c.req.param("skillId")),
      ),
    );

  return c.json({ success: true });
});

// Update skill overrides
agentsRoutes.patch("/:agentId/skills/:skillId", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only manage skills for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = patchEquipSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update payload");

  const updates: Partial<typeof agentSkills.$inferInsert> = {};

  if (parsed.data.config_overrides !== undefined) {
    updates.configOverridesJson = parsed.data.config_overrides;
  }
  if (parsed.data.enabled !== undefined) {
    updates.enabled = parsed.data.enabled;
  }

  if (Object.keys(updates).length === 0) return badRequest(c, "No fields to update");

  const db = c.get("db");
  await db
    .update(agentSkills)
    .set(updates)
    .where(
      and(
        eq(agentSkills.agentId, ownedAgent.id),
        eq(agentSkills.skillId, c.req.param("skillId")),
      ),
    );

  return c.json({ success: true });
});

// Execute skill
agentsRoutes.post("/:agentId/skills/:skillId/execute", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only execute skills for your own agent");

  const skillId = c.req.param("skillId");
  const db = c.get("db");

  const equipped = await firstRow(db
    .select({ skill_id: agentSkills.skillId })
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.agentId, ownedAgent.id),
        eq(agentSkills.skillId, skillId),
        eq(agentSkills.enabled, true),
      ),
    )
  );

  if (!equipped) return badRequest(c, "Skill is not equipped on this agent");

  const rateLimited = await checkRateLimit(db, ownedAgent.id);
  if (rateLimited) {
    return c.json({ error: "Rate limit exceeded: 60 executions per hour" }, 429);
  }

  const skill = await firstRow(db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.enabled, true)))
  );

  if (!skill) return notFound(c, "Skill not found");

  const body = await c.req.json().catch(() => null);
  const parsed = executeSkillSchema.safeParse(body ?? {});
  const input = parsed.success ? (parsed.data.input ?? {}) : {};

  // Map Drizzle row to SkillDefinition format
  const skillDef: SkillDefinition = {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description ?? "",
    category: skill.category,
    input_schema: skill.inputSchema ?? {},
    output_schema: skill.outputSchema ?? {},
    action_type: skill.actionType,
    action_config: skill.actionConfig ?? {},
    visibility: skill.visibility ?? "public",
    creator_agent_id: skill.creatorAgentId ?? null,
    enabled: skill.enabled ? 1 : 0,
    created_at: skill.createdAt.toISOString(),
    updated_at: skill.updatedAt.toISOString(),
  };

  const result = await executeSkill(c.env, ownedAgent.id, skillDef, input as Record<string, unknown>);

  return c.json({ result });
});

// Execution history
agentsRoutes.get("/:agentId/skills/logs", requireAuth, async (c) => {
  const ownedAgent = await ensureOwnedAgent(c, c.req.param("agentId"));
  if (!ownedAgent) return forbidden(c, "You can only view logs for your own agent");

  const db = c.get("db");
  const rows = await db
    .select({
      id: skillExecutionLogs.id,
      skill_id: skillExecutionLogs.skillId,
      status: skillExecutionLogs.status,
      input_json: skillExecutionLogs.inputJson,
      output_json: skillExecutionLogs.outputJson,
      duration_ms: skillExecutionLogs.durationMs,
      error_message: skillExecutionLogs.errorMessage,
      created_at: skillExecutionLogs.createdAt,
    })
    .from(skillExecutionLogs)
    .where(eq(skillExecutionLogs.agentId, ownedAgent.id))
    .orderBy(desc(skillExecutionLogs.createdAt))
    .limit(50);

  return c.json({ items: rows });
});

agentsRoutes.get("/:agentId/stats", async (c) => {
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

  const stats = await db.execute<{
    followers_count: number;
    subscribers_count: number;
    posts_count: number;
    agent_followers_count: number;
    agent_subscribers_count: number;
  }>(sql`
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
  `);

  const row = stats.rows[0];

  return c.json({
    stats: {
      followersCount: row?.followers_count ?? 0,
      subscribersCount: row?.subscribers_count ?? 0,
      postsCount: row?.posts_count ?? 0,
      agentFollowersCount: row?.agent_followers_count ?? 0,
      agentSubscribersCount: row?.agent_subscribers_count ?? 0,
    },
  });
});

agentsRoutes.get("/:agentId/posts", optionalAuth, async (c) => {
  const authUser = c.get("authUser");
  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const owner = await firstRow(db
    .select({ owner_user_id: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
  );
  if (!owner) {
    return notFound(c, "Agent not found");
  }

  let canSeeSubscriberPosts = false;
  if (authUser) {
    if (authUser.role === "admin" || authUser.id === owner.owner_user_id) {
      canSeeSubscriberPosts = true;
    } else {
      const subscription = await firstRow(db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, authUser.id),
            eq(subscriptions.agentId, agentId),
            eq(subscriptions.status, "active"),
          ),
        )
      );
      canSeeSubscriberPosts = Boolean(subscription);
    }
  }

  const visibilityFilter = canSeeSubscriberPosts
    ? or(eq(posts.visibility, "public"), eq(posts.visibility, "subscriber"))
    : eq(posts.visibility, "public");

  const postsResult = await db
    .select({
      id: posts.id,
      body_text: posts.bodyText,
      media_type: posts.mediaType,
      media_url: posts.mediaUrl,
      visibility: posts.visibility,
      ai_generated: posts.aiGenerated,
      created_at: posts.createdAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.agentId, agentId),
        sql`${posts.deletedAt} IS NULL`,
        visibilityFilter,
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(50);

  return c.json({ items: postsResult });
});

agentsRoutes.get("/:slug", optionalAuth, async (c) => {
  const slug = c.req.param("slug");
  const authUser = c.get("authUser");
  const db = c.get("db");

  const agent = await firstRow(db
    .select({
      id: agents.id,
      owner_user_id: agents.ownerUserId,
      name: agents.name,
      slug: agents.slug,
      bio: agents.bio,
      personality_tags_json: agents.personalityTagsJson,
      skills_json: agents.skillsJson,
      cli_tools_json: agents.cliToolsJson,
      avatar_url: agents.avatarUrl,
      banner_url: agents.bannerUrl,
      socials_json: agents.socialsJson,
      created_at: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.slug, slug))
  );

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
        firstRow(db
          .select({ id: follows.id })
          .from(follows)
          .where(
            and(eq(follows.userId, authUser.id), eq(follows.agentId, agent.id)),
          )
        ),
        firstRow(db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.userId, authUser.id),
              eq(subscriptions.agentId, agent.id),
              eq(subscriptions.status, "active"),
            ),
          )
        ),
      ]);
      isFollowed = Boolean(followRow);
      isSubscribed = Boolean(subscriptionRow);
      canSeeSubscriberPosts = isSubscribed;
    }
  }

  const visibilityFilter = canSeeSubscriberPosts
    ? or(eq(posts.visibility, "public"), eq(posts.visibility, "subscriber"))
    : eq(posts.visibility, "public");

  const postsResult = await db.execute<{
    id: string;
    body_text: string;
    media_type: "image" | "video" | "none";
    media_url: string | null;
    visibility: "public" | "subscriber";
    ai_generated: boolean;
    created_at: string;
    likes_count: number;
    comments_count: number;
  }>(sql`
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
       AND ${canSeeSubscriberPosts ? sql`p.visibility IN ('public', 'subscriber')` : sql`p.visibility = 'public'`}
     ORDER BY p.created_at DESC
     LIMIT 25
  `);

  const equippedSkills = await db
    .select({
      id: skills.id,
      slug: skills.slug,
      name: skills.name,
      description: skills.description,
      category: skills.category,
      action_type: skills.actionType,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(
      and(
        eq(agentSkills.agentId, agent.id),
        eq(agentSkills.enabled, true),
        eq(skills.enabled, true),
      ),
    )
    .orderBy(desc(agentSkills.equippedAt));

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
    posts: postsResult.rows,
  });
});
