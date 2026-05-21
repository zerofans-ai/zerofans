import { Hono } from "hono";
import { z } from "zod";
import { eq, sql, and } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { Database } from "../db";
import type { SkillDefinition } from "../types/skills";
import { agents, skills } from "../db/schema";

const skillCategoryEnum = z.enum([
  "content",
  "engagement",
  "analytics",
  "integration",
  "automation",
  "utility",
]);

const actionTypeEnum = z.enum([
  "http_request",
  "ai_generate",
  "post_to_feed",
  "script",
  "noop",
]);

const createSkillSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  category: skillCategoryEnum,
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  action_type: actionTypeEnum,
  action_config: z.record(z.unknown()).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  creator_agent_id: z.string().uuid().nullable().optional(),
});

const patchSkillSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  category: skillCategoryEnum.optional(),
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  action_type: actionTypeEnum.optional(),
  action_config: z.record(z.unknown()).optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

const discoverQuerySchema = z.object({
  q: z.string().max(80).optional(),
  category: skillCategoryEnum.optional(),
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

async function makeUniqueSkillSlug(baseName: string, db: Database): Promise<string> {
  const baseSlug = toSlug(baseName) || "skill";
  let candidate = baseSlug;
  let attempts = 0;

  while (attempts < 8) {
    const existing = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.slug, candidate))
      .get();

    if (!existing) return candidate;
    attempts += 1;
    candidate = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
  }

  return `${baseSlug}-${Date.now()}`;
}

function formatSkill(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    input_schema: safeParseJson(row.input_schema as string),
    output_schema: safeParseJson(row.output_schema as string),
    action_type: row.action_type,
    action_config: safeParseJson(row.action_config as string),
    visibility: row.visibility,
    creator_agent_id: row.creator_agent_id,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeParseJson(str: string | null): unknown {
  try {
    return JSON.parse(str ?? "{}");
  } catch {
    return {};
  }
}

export const skillsRoutes = new Hono<AppEnv>();

// Create skill
skillsRoutes.post("/", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid skill payload");

  const db = c.get("db");

  if (parsed.data.creator_agent_id) {
    const agent = await db
      .select({ id: agents.id, ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, parsed.data.creator_agent_id))
      .get();

    if (!agent) return notFound(c, "Creator agent not found");
    if (agent.ownerUserId !== authUser.id && authUser.role !== "admin") {
      return forbidden(c, "You can only create skills for your own agents");
    }
  }

  const id = crypto.randomUUID();
  const slug = await makeUniqueSkillSlug(parsed.data.name, db);

  await db.insert(skills).values({
    id,
    slug,
    name: parsed.data.name.trim(),
    description: parsed.data.description ?? "",
    category: parsed.data.category,
    inputSchema: JSON.stringify(parsed.data.input_schema ?? {}),
    outputSchema: JSON.stringify(parsed.data.output_schema ?? {}),
    actionType: parsed.data.action_type,
    actionConfig: JSON.stringify(parsed.data.action_config ?? {}),
    visibility: parsed.data.visibility ?? "public",
    creatorAgentId: parsed.data.creator_agent_id ?? null,
    enabled: true,
  });

  return c.json({
    skill: {
      id,
      slug,
      name: parsed.data.name.trim(),
      description: parsed.data.description ?? "",
      category: parsed.data.category,
      input_schema: parsed.data.input_schema ?? {},
      output_schema: parsed.data.output_schema ?? {},
      action_type: parsed.data.action_type,
      action_config: parsed.data.action_config ?? {},
      visibility: parsed.data.visibility ?? "public",
      creator_agent_id: parsed.data.creator_agent_id ?? null,
      enabled: true,
    },
  });
});

// Discover/search skills
skillsRoutes.get("/discover", optionalAuth, async (c) => {
  const parsed = discoverQuerySchema.safeParse({
    q: c.req.query("q"),
    category: c.req.query("category"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) return badRequest(c, "Invalid query");

  const limit = parsed.data.limit ?? 24;
  const query = `%${(parsed.data.q ?? "").trim().toLowerCase()}%`;
  const db = c.get("db");

  let querySql = sql`SELECT * FROM skills WHERE enabled = true AND visibility = 'public'`;

  const conditions: ReturnType<typeof sql>[] = [];

  if (parsed.data.q) {
    conditions.push(sql`AND (lower(name) LIKE ${query} OR lower(description) LIKE ${query})`);
  }

  if (parsed.data.category) {
    conditions.push(sql`AND category = ${parsed.data.category}`);
  }

  conditions.push(sql`ORDER BY created_at DESC LIMIT ${limit}`);

  const fullSql = sql.join([querySql, ...conditions], sql` `);

  const rows = await db.execute(fullSql);

  return c.json({
    items: rows.rows.map((row) => formatSkill(row as Record<string, unknown>)),
  });
});

// Get skill by slug or id
skillsRoutes.get("/:slugOrId", optionalAuth, async (c) => {
  const slugOrId = c.req.param("slugOrId");
  const db = c.get("db");

  const row = await db.execute(sql`
    SELECT * FROM skills WHERE (slug = ${slugOrId} OR id = ${slugOrId}) AND enabled = true LIMIT 1
  `);

  const skill = row.rows[0];
  if (!skill) return notFound(c, "Skill not found");

  return c.json({ skill: formatSkill(skill as Record<string, unknown>) });
});

// Update skill (owner only)
skillsRoutes.patch("/:skillId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = patchSkillSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update payload");

  const db = c.get("db");
  const skillId = c.req.param("skillId");

  const skillRow = await db
    .select()
    .from(skills)
    .where(eq(skills.id, skillId))
    .get();

  if (!skillRow) return notFound(c, "Skill not found");

  if (skillRow.creatorAgentId) {
    const agent = await db
      .select({ ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, skillRow.creatorAgentId))
      .get();

    if (agent && agent.ownerUserId !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can update built-in skills");
  }

  const updates: Partial<typeof skills.$inferInsert> = {};

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name.trim();
  }
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description;
  }
  if (parsed.data.category !== undefined) {
    updates.category = parsed.data.category;
  }
  if (parsed.data.input_schema !== undefined) {
    updates.inputSchema = JSON.stringify(parsed.data.input_schema);
  }
  if (parsed.data.output_schema !== undefined) {
    updates.outputSchema = JSON.stringify(parsed.data.output_schema);
  }
  if (parsed.data.action_type !== undefined) {
    updates.actionType = parsed.data.action_type;
  }
  if (parsed.data.action_config !== undefined) {
    updates.actionConfig = JSON.stringify(parsed.data.action_config);
  }
  if (parsed.data.visibility !== undefined) {
    updates.visibility = parsed.data.visibility;
  }

  if (Object.keys(updates).length === 0) return badRequest(c, "No fields to update");

  updates.updatedAt = sql`now()`;
  await db.update(skills).set(updates).where(eq(skills.id, skillRow.id));

  return c.json({ success: true });
});

// Delete (disable) skill
skillsRoutes.delete("/:skillId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const db = c.get("db");
  const skillId = c.req.param("skillId");

  const skillRow = await db
    .select()
    .from(skills)
    .where(eq(skills.id, skillId))
    .get();

  if (!skillRow) return notFound(c, "Skill not found");

  if (skillRow.creatorAgentId) {
    const agent = await db
      .select({ ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, skillRow.creatorAgentId))
      .get();

    if (agent && agent.ownerUserId !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can delete built-in skills");
  }

  await db
    .update(skills)
    .set({
      enabled: false,
      updatedAt: sql`now()`,
    })
    .where(eq(skills.id, skillRow.id));

  return c.json({ success: true });
});
