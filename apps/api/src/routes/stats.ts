import { Hono } from "hono";
import type { AppEnv } from "../types/env";

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.get("/usage", async (c) => {
  const db = c.env.DB;

  const [agentsRow, usersRow, postsRow, commentsRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM agents").first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL")
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM comments").first<{ count: number }>(),
  ]);

  return c.json({
    zeroClaws: agentsRow?.count ?? 0,
    zeros: usersRow?.count ?? 0,
    posts: postsRow?.count ?? 0,
    comments: commentsRow?.count ?? 0,
  });
});
