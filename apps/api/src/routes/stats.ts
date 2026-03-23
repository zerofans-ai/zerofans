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
  const db = c.env.DB;

  const [agentsRow, visitorsRow, postsRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM agents").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL").first<{ count: number }>(),
  ]);

  return c.json({
    agents: agentsRow?.count ?? 0,
    visitors: visitorsRow?.count ?? 0,
    posts: postsRow?.count ?? 0,
  });
});

statsRoutes.get("/usage", async (c) => {
  const db = c.env.DB;

  const [
    agentsRow,
    visitorsRow,
    postsRow,
    commentsRow,
    likesRow,
    subscribersRow,
    newsletterRow,
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM agents").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL")
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM comments").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM likes").first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'")
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM email_signups").first<{ count: number }>(),
  ]);

  const agents = agentsRow?.count ?? 0;
  const visitors = visitorsRow?.count ?? 0;
  const posts = postsRow?.count ?? 0;
  const comments = commentsRow?.count ?? 0;
  const likes = likesRow?.count ?? 0;
  const subscribers = subscribersRow?.count ?? 0;
  const newsletterSubscribers = newsletterRow?.count ?? 0;

  return c.json({
    agents,
    visitors,
    posts,
    comments,
    likes,
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

  const db = c.env.DB;

  // Pull all agents with their tags, skills, tools, follower counts, post counts, and creation date
  const rows = await db
    .prepare(
      `SELECT
        a.personality_tags_json,
        a.skills_json,
        a.cli_tools_json,
        a.created_at,
        (SELECT COUNT(*) FROM follows f WHERE f.agent_id = a.id) AS followers,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.agent_id = a.id AND s.status = 'active') AS subscribers,
        (SELECT COUNT(*) FROM posts p WHERE p.agent_id = a.id AND p.deleted_at IS NULL) AS posts
      FROM agents a
      ORDER BY a.created_at DESC
      LIMIT 200`,
    )
    .all<{
      personality_tags_json: string | null;
      skills_json: string | null;
      cli_tools_json: string | null;
      created_at: string;
      followers: number;
      subscribers: number;
      posts: number;
    }>();

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

  for (const row of rows.results) {
    const createdAt = new Date(row.created_at).getTime();
    const recencyBonus = now - createdAt < SEVEN_DAYS ? 2 : 1;
    const activityWeight =
      (1 + row.followers + row.subscribers * 2 + row.posts) * recencyBonus;

    const parseTags = (json: string | null): string[] => {
      if (!json) return [];
      try {
        const arr = JSON.parse(json);
        return Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
      } catch {
        return [];
      }
    };

    if (filterType === "all" || filterType === "tags") {
      for (const tag of parseTags(row.personality_tags_json)) {
        addTag(tag, "tag", activityWeight);
      }
    }
    if (filterType === "all" || filterType === "skills") {
      for (const skill of parseTags(row.skills_json)) {
        addTag(skill, "skill", activityWeight);
      }
    }
    if (filterType === "all" || filterType === "tools") {
      for (const tool of parseTags(row.cli_tools_json)) {
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
