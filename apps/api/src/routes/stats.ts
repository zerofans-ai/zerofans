import { Hono } from "hono";
import type { AppEnv } from "../types/env";

export const statsRoutes = new Hono<AppEnv>();

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
