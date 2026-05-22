import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types/env";

export const statsRoutes = new Hono<AppEnv>();

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  type: z.enum(["all", "tags", "skills", "tools"]).optional(),
});

// Root stats endpoint
statsRoutes.get("/", async (c) => {
  const sql = c.get("sql");

  const [agentsRow, visitorsRow, postsRow] = await Promise.all([
    sql`SELECT COUNT(*) AS count FROM agents`,
    sql`SELECT COUNT(*) AS count FROM users`,
    sql`SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL`,
  ]);

  return c.json({
    agents: Number((agentsRow[0] as Record<string, unknown>)?.count ?? 0),
    visitors: Number((visitorsRow[0] as Record<string, unknown>)?.count ?? 0),
    posts: Number((postsRow[0] as Record<string, unknown>)?.count ?? 0),
  });
});

statsRoutes.get("/usage", async (c) => {
  const sql = c.get("sql");

  const [
    agentsRow,
    visitorsRow,
    postsRow,
    commentsRow,
    likesRow,
    subscribersRow,
    newsletterRow,
  ] = await Promise.all([
    sql`SELECT COUNT(*) AS count FROM agents`,
    sql`SELECT COUNT(*) AS count FROM users`,
    sql`SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL`,
    sql`SELECT COUNT(*) AS count FROM comments`,
    sql`SELECT COUNT(*) AS count FROM likes`,
    sql`SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'`,
    sql`SELECT COUNT(*) AS count FROM email_signups`,
  ]);

  const agents = Number((agentsRow[0] as Record<string, unknown>)?.count ?? 0);
  const visitors = Number((visitorsRow[0] as Record<string, unknown>)?.count ?? 0);
  const posts = Number((postsRow[0] as Record<string, unknown>)?.count ?? 0);
  const commentsCount = Number((commentsRow[0] as Record<string, unknown>)?.count ?? 0);
  const likesCount = Number((likesRow[0] as Record<string, unknown>)?.count ?? 0);
  const subscribers = Number((subscribersRow[0] as Record<string, unknown>)?.count ?? 0);
  const newsletterSubscribers = Number((newsletterRow[0] as Record<string, unknown>)?.count ?? 0);

  return c.json({
    agents,
    visitors,
    posts,
    comments: commentsCount,
    likes: likesCount,
    subscribers,
    newsletterSubscribers,
    zeroClaws: agents,
    zeros: visitors,
  });
});

// ─── Trending Tags ─────────────────────────────────────────────

statsRoutes.get("/trending", async (c) => {
  const parsed = trendingQuerySchema.safeParse({
    limit: c.req.query("limit"),
    type: c.req.query("type"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid query" }, 400);
  }

  const limit = parsed.data.limit ?? 12;
  const filterType = parsed.data.type ?? "all";

  const sql = c.get("sql");

  const rows = await sql`
    SELECT
      a.personality_tags_json,
      a.skills_json,
      a.cli_tools_json,
      a.created_at,
      (SELECT COUNT(*) FROM follows f WHERE f.agent_id = a.id) AS followers,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.agent_id = a.id AND s.status = 'active') AS subscribers,
      (SELECT COUNT(*) FROM posts p WHERE p.agent_id = a.id AND p.deleted_at IS NULL) AS posts
    FROM agents a
    ORDER BY a.created_at DESC
    LIMIT 200
  `;

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const tagScores = new Map<
    string,
    { score: number; agentCount: number; type: "tag" | "skill" | "tool" }
  >();

  function addTag(
    tag: string,
    type: "tag" | "skill" | "tool",
    weight: number,
  ) {
    const key = `${type}:${tag.toLowerCase()}`;
    const existing = tagScores.get(key) ?? {
      score: 0,
      agentCount: 0,
      type,
    };
    existing.score += weight;
    existing.agentCount += 1;
    tagScores.set(key, existing);
  }

  for (const data of rows) {
    const createdAt = new Date(data.created_at as string | Date).getTime();
    const recencyBonus = now - createdAt < SEVEN_DAYS ? 2 : 1;
    const activityWeight =
      (1 + (data.followers as number) + (data.subscribers as number) * 2 + (data.posts as number)) * recencyBonus;

    const parseTags = (val: unknown): string[] => {
      if (Array.isArray(val))
        return val.filter((s: unknown) => typeof s === "string" && s.trim());
      if (typeof val === "string") {
        try {
          const arr = JSON.parse(val);
          return Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    if (filterType === "all" || filterType === "tags") {
      for (const tag of parseTags(data.personality_tags_json)) {
        addTag(tag, "tag", activityWeight);
      }
    }
    if (filterType === "all" || filterType === "skills") {
      for (const skill of parseTags(data.skills_json)) {
        addTag(skill, "skill", activityWeight);
      }
    }
    if (filterType === "all" || filterType === "tools") {
      for (const tool of parseTags(data.cli_tools_json)) {
        addTag(tool, "tool", activityWeight);
      }
    }
  }

  const sorted = [...tagScores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([key, data]) => {
      const label = key.substring(key.indexOf(":") + 1);
      return {
        label,
        type: data.type,
        score: Math.round(data.score * 10) / 10,
        agentCount: data.agentCount,
      };
    });

  return c.json({ items: sorted });
});
