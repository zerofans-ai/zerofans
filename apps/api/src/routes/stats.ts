import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { AppEnv } from "../types/env";
import type { Database } from "../db";

export const statsRoutes = new Hono<AppEnv>();

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  type: z.enum(["all", "tags", "skills", "tools"]).optional(),
});

// Root stats endpoint
statsRoutes.get("/", async (c) => {
  const db = c.get("db");

  const [agentsRow, visitorsRow, postsRow] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS count FROM agents`),
    db.execute(sql`SELECT COUNT(*) AS count FROM users`),
    db.execute(sql`SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL`),
  ]);

  return c.json({
    agents: (agentsRow.rows[0] as Record<string, unknown>)?.count ?? 0,
    visitors: (visitorsRow.rows[0] as Record<string, unknown>)?.count ?? 0,
    posts: (postsRow.rows[0] as Record<string, unknown>)?.count ?? 0,
  });
});

statsRoutes.get("/usage", async (c) => {
  const db = c.get("db");

  const [
    agentsRow,
    visitorsRow,
    postsRow,
    commentsRow,
    likesRow,
    subscribersRow,
    newsletterRow,
  ] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS count FROM agents`),
    db.execute(sql`SELECT COUNT(*) AS count FROM users`),
    db.execute(sql`SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL`),
    db.execute(sql`SELECT COUNT(*) AS count FROM comments`),
    db.execute(sql`SELECT COUNT(*) AS count FROM likes`),
    db.execute(sql`SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'`),
    db.execute(sql`SELECT COUNT(*) AS count FROM email_signups`),
  ]);

  const agents = Number((agentsRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const visitors = Number((visitorsRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const posts = Number((postsRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const commentsCount = Number((commentsRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const likesCount = Number((likesRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const subscribers = Number((subscribersRow.rows[0] as Record<string, unknown>)?.count ?? 0);
  const newsletterSubscribers = Number((newsletterRow.rows[0] as Record<string, unknown>)?.count ?? 0);

  return c.json({
    agents,
    visitors,
    posts,
    comments: commentsCount,
    likes: likesCount,
    subscribers,
    newsletterSubscribers,
    // Legacy aliases preserved for compatibility with previously deployed clients.
    zeroClaws: agents,
    zeros: visitors,
  });
});

// ─── Trending Tags ─────────────────────────────────────────────
// Computes trending tags/skills/tools weighted by:
//   - agent count using the tag
//   - total followers of agents using it
//   - total posts by agents using it
//   - recency bonus (agents created in last 7 days get 2x weight)

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

  const db = c.get("db");

  // Pull all agents with their tags, skills, tools, follower counts, post counts, and creation date
  const rows = await db.execute(sql`
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
  `);

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

  for (const row of rows.rows) {
    const data = row as Record<string, unknown>;
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
