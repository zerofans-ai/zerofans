import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { SkillDefinition } from "../types/skills";

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

async function makeUniqueSkillSlug(baseName: string, db: D1Database): Promise<string> {
  const baseSlug = toSlug(baseName) || "skill";
  let candidate = baseSlug;
  let attempts = 0;

  while (attempts < 8) {
    const existing = await db
      .prepare("SELECT id FROM skills WHERE slug = ?1 LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();

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

  if (parsed.data.creator_agent_id) {
    const agent = await c.env.DB.prepare(
      "SELECT id, owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
    )
      .bind(parsed.data.creator_agent_id)
      .first<{ id: string; owner_user_id: string }>();

    if (!agent) return notFound(c, "Creator agent not found");
    if (agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c, "You can only create skills for your own agents");
    }
  }

  const id = crypto.randomUUID();
  const slug = await makeUniqueSkillSlug(parsed.data.name, c.env.DB);

  await c.env.DB.prepare(
    `INSERT INTO skills (
      id, slug, name, description, category, input_schema, output_schema,
      action_type, action_config, visibility, creator_agent_id, enabled,
      created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      slug,
      parsed.data.name.trim(),
      parsed.data.description ?? "",
      parsed.data.category,
      JSON.stringify(parsed.data.input_schema ?? {}),
      JSON.stringify(parsed.data.output_schema ?? {}),
      parsed.data.action_type,
      JSON.stringify(parsed.data.action_config ?? {}),
      parsed.data.visibility ?? "public",
      parsed.data.creator_agent_id ?? null,
    )
    .run();

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
      enabled: 1,
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

  let sql = `SELECT * FROM skills WHERE enabled = 1 AND visibility = 'public'`;
  const bindings: unknown[] = [];

  if (parsed.data.q) {
    sql += ` AND (lower(name) LIKE ?${bindings.length + 1} OR lower(description) LIKE ?${bindings.length + 1})`;
    bindings.push(query);
  }

  if (parsed.data.category) {
    sql += ` AND category = ?${bindings.length + 1}`;
    bindings.push(parsed.data.category);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?${bindings.length + 1}`;
  bindings.push(limit);

  const rows = await c.env.DB.prepare(sql)
    .bind(...bindings)
    .all();

  return c.json({
    items: (rows.results ?? []).map((row) => formatSkill(row as Record<string, unknown>)),
  });
});

// Get skill by slug or id
skillsRoutes.get("/:slugOrId", optionalAuth, async (c) => {
  const slugOrId = c.req.param("slugOrId");

  const row = await c.env.DB.prepare(
    "SELECT * FROM skills WHERE (slug = ?1 OR id = ?1) AND enabled = 1 LIMIT 1",
  )
    .bind(slugOrId)
    .first();

  if (!row) return notFound(c, "Skill not found");

  return c.json({ skill: formatSkill(row as Record<string, unknown>) });
});

// Update skill (owner only)
skillsRoutes.patch("/:skillId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = patchSkillSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid update payload");

  const skill = await c.env.DB.prepare("SELECT * FROM skills WHERE id = ?1 LIMIT 1")
    .bind(c.req.param("skillId"))
    .first<SkillDefinition>();

  if (!skill) return notFound(c, "Skill not found");

  if (skill.creator_agent_id) {
    const agent = await c.env.DB.prepare(
      "SELECT owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
    )
      .bind(skill.creator_agent_id)
      .first<{ owner_user_id: string }>();

    if (agent && agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can update built-in skills");
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.name !== undefined) {
    updates.push("name = ?");
    values.push(parsed.data.name.trim());
  }
  if (parsed.data.description !== undefined) {
    updates.push("description = ?");
    values.push(parsed.data.description);
  }
  if (parsed.data.category !== undefined) {
    updates.push("category = ?");
    values.push(parsed.data.category);
  }
  if (parsed.data.input_schema !== undefined) {
    updates.push("input_schema = ?");
    values.push(JSON.stringify(parsed.data.input_schema));
  }
  if (parsed.data.output_schema !== undefined) {
    updates.push("output_schema = ?");
    values.push(JSON.stringify(parsed.data.output_schema));
  }
  if (parsed.data.action_type !== undefined) {
    updates.push("action_type = ?");
    values.push(parsed.data.action_type);
  }
  if (parsed.data.action_config !== undefined) {
    updates.push("action_config = ?");
    values.push(JSON.stringify(parsed.data.action_config));
  }
  if (parsed.data.visibility !== undefined) {
    updates.push("visibility = ?");
    values.push(parsed.data.visibility);
  }

  if (updates.length === 0) return badRequest(c, "No fields to update");

  updates.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE skills SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values, skill.id)
    .run();

  return c.json({ success: true });
});

// Delete (disable) skill
skillsRoutes.delete("/:skillId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const skill = await c.env.DB.prepare("SELECT * FROM skills WHERE id = ?1 LIMIT 1")
    .bind(c.req.param("skillId"))
    .first<SkillDefinition>();

  if (!skill) return notFound(c, "Skill not found");

  if (skill.creator_agent_id) {
    const agent = await c.env.DB.prepare(
      "SELECT owner_user_id FROM agents WHERE id = ?1 LIMIT 1",
    )
      .bind(skill.creator_agent_id)
      .first<{ owner_user_id: string }>();

    if (agent && agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can delete built-in skills");
  }

  await c.env.DB.prepare(
    "UPDATE skills SET enabled = 0, updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(skill.id)
    .run();

  return c.json({ success: true });
});
