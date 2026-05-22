import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { optionalAuth, requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import { firstRow } from "../db";
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

async function makeUniqueSkillSlug(baseName: string, sql: import("../db").Sql): Promise<string> {
  const baseSlug = toSlug(baseName) || "skill";
  let candidate = baseSlug;
  let attempts = 0;

  while (attempts < 8) {
    const existing = await firstRow(sql`
      SELECT id FROM skills WHERE slug = ${candidate}
    `);

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
    input_schema: row.input_schema,
    output_schema: row.output_schema,
    action_type: row.action_type,
    action_config: row.action_config,
    visibility: row.visibility,
    creator_agent_id: row.creator_agent_id,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const skillsRoutes = new Hono<AppEnv>();

// Create skill
skillsRoutes.post("/", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid skill payload");

  const sql = c.get("sql");

  if (parsed.data.creator_agent_id) {
    const agent = await firstRow(sql`
      SELECT id, owner_user_id FROM agents WHERE id = ${parsed.data.creator_agent_id}
    `);

    if (!agent) return notFound(c, "Creator agent not found");
    if (agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c, "You can only create skills for your own agents");
    }
  }

  const id = crypto.randomUUID();
  const slug = await makeUniqueSkillSlug(parsed.data.name, sql);
  const name = parsed.data.name.trim();
  const description = parsed.data.description ?? "";
  const category = parsed.data.category;
  const inputSchema = parsed.data.input_schema ?? {};
  const outputSchema = parsed.data.output_schema ?? {};
  const actionType = parsed.data.action_type;
  const actionConfig = parsed.data.action_config ?? {};
  const visibility = parsed.data.visibility ?? "public";
  const creatorAgentId = parsed.data.creator_agent_id ?? null;

  await sql`
    INSERT INTO skills (id, slug, name, description, category, input_schema, output_schema, action_type, action_config, visibility, creator_agent_id, enabled)
    VALUES (${id}, ${slug}, ${name}, ${description}, ${category}, ${inputSchema}, ${outputSchema}, ${actionType}, ${actionConfig}, ${visibility}, ${creatorAgentId}, true)
  `;

  return c.json({
    skill: {
      id,
      slug,
      name,
      description,
      category,
      input_schema: inputSchema,
      output_schema: outputSchema,
      action_type: actionType,
      action_config: actionConfig,
      visibility,
      creator_agent_id: creatorAgentId,
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
  const searchTerm = (parsed.data.q ?? "").trim().toLowerCase();
  const query = `%${searchTerm}%`;
  const sql = c.get("sql");

  let rows: Record<string, unknown>[];

  if (parsed.data.q && parsed.data.category) {
    rows = await sql`
      SELECT * FROM (
        SELECT * FROM skills
        WHERE enabled = true AND visibility = 'public'
          AND (lower(name) LIKE ${query} OR lower(description) LIKE ${query})
          AND category = ${parsed.data.category}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) sub
    `;
  } else if (parsed.data.q) {
    rows = await sql`
      SELECT * FROM (
        SELECT * FROM skills
        WHERE enabled = true AND visibility = 'public'
          AND (lower(name) LIKE ${query} OR lower(description) LIKE ${query})
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) sub
    `;
  } else if (parsed.data.category) {
    rows = await sql`
      SELECT * FROM (
        SELECT * FROM skills
        WHERE enabled = true AND visibility = 'public'
          AND category = ${parsed.data.category}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) sub
    `;
  } else {
    rows = await sql`
      SELECT * FROM (
        SELECT * FROM skills
        WHERE enabled = true AND visibility = 'public'
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) sub
    `;
  }

  return c.json({
    items: rows.map((row) => formatSkill(row as Record<string, unknown>)),
  });
});

// Get skill by slug or id
skillsRoutes.get("/:slugOrId", optionalAuth, async (c) => {
  const slugOrId = c.req.param("slugOrId");
  const sql = c.get("sql");

  const skill = await firstRow(sql`
    SELECT * FROM skills WHERE (slug = ${slugOrId} OR id = ${slugOrId}) AND enabled = true LIMIT 1
  `);

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

  const sql = c.get("sql");
  const skillId = c.req.param("skillId");

  const skillRow = await firstRow(sql`
    SELECT * FROM skills WHERE id = ${skillId}
  `);

  if (!skillRow) return notFound(c, "Skill not found");

  if (skillRow.creator_agent_id) {
    const agent = await firstRow(sql`
      SELECT owner_user_id FROM agents WHERE id = ${skillRow.creator_agent_id}
    `);

    if (agent && agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can update built-in skills");
  }

  const data = parsed.data;
  const hasUpdates =
    data.name !== undefined ||
    data.description !== undefined ||
    data.category !== undefined ||
    data.input_schema !== undefined ||
    data.output_schema !== undefined ||
    data.action_type !== undefined ||
    data.action_config !== undefined ||
    data.visibility !== undefined;

  if (!hasUpdates) return badRequest(c, "No fields to update");

  // Build dynamic SET clause using sql.query() with $1, $2 placeholders
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) {
    params.push(data.name.trim());
    setClauses.push(`name = $${params.length}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    setClauses.push(`description = $${params.length}`);
  }
  if (data.category !== undefined) {
    params.push(data.category);
    setClauses.push(`category = $${params.length}`);
  }
  if (data.input_schema !== undefined) {
    params.push(JSON.stringify(data.input_schema));
    setClauses.push(`input_schema = $${params.length}::jsonb`);
  }
  if (data.output_schema !== undefined) {
    params.push(JSON.stringify(data.output_schema));
    setClauses.push(`output_schema = $${params.length}::jsonb`);
  }
  if (data.action_type !== undefined) {
    params.push(data.action_type);
    setClauses.push(`action_type = $${params.length}`);
  }
  if (data.action_config !== undefined) {
    params.push(JSON.stringify(data.action_config));
    setClauses.push(`action_config = $${params.length}::jsonb`);
  }
  if (data.visibility !== undefined) {
    params.push(data.visibility);
    setClauses.push(`visibility = $${params.length}`);
  }

  setClauses.push("updated_at = now()");
  params.push(skillRow.id);

  const queryStr = `UPDATE skills SET ${setClauses.join(", ")} WHERE id = $${params.length}::uuid`;
  await sql.query(queryStr, params);

  return c.json({ success: true });
});

// Delete (disable) skill
skillsRoutes.delete("/:skillId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const sql = c.get("sql");
  const skillId = c.req.param("skillId");

  const skillRow = await firstRow(sql`
    SELECT * FROM skills WHERE id = ${skillId}
  `);

  if (!skillRow) return notFound(c, "Skill not found");

  if (skillRow.creator_agent_id) {
    const agent = await firstRow(sql`
      SELECT owner_user_id FROM agents WHERE id = ${skillRow.creator_agent_id}
    `);

    if (agent && agent.owner_user_id !== authUser.id && authUser.role !== "admin") {
      return forbidden(c);
    }
  } else if (authUser.role !== "admin") {
    return forbidden(c, "Only admins can delete built-in skills");
  }

  await sql`
    UPDATE skills SET enabled = false, updated_at = now() WHERE id = ${skillRow.id}
  `;

  return c.json({ success: true });
});
