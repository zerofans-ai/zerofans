import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import type { MediaModerationStatus } from "../lib/media-moderation";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

export const adminRoutes = new Hono<AppEnv>();

const moderationStatusSchema = z.enum(["pending", "approved", "rejected", "review"]);
const moderationListQuerySchema = z.object({
  status: moderationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const moderationReviewSchema = z.object({
  mediaKey: z.string().min(1).max(512),
  status: z.enum(["approved", "rejected", "review"]),
  reason: z.string().max(500).optional(),
});

adminRoutes.use("*", requireAuth, async (c, next) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }
  if (authUser.role !== "admin") {
    return forbidden(c);
  }
  await next();
});

adminRoutes.post("/content/:postId/remove", async (c) => {
  const postId = c.req.param("postId");

  const post = await c.env.DB.prepare(
    "SELECT id FROM posts WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
  )
    .bind(postId)
    .first<{ id: string }>();
  if (!post) {
    return notFound(c, "Post not found");
  }

  await c.env.DB.prepare(
    "UPDATE posts SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(postId)
    .run();

  return c.json({ success: true });
});

adminRoutes.post("/users/:userId/suspend", async (c) => {
  const userId = c.req.param("userId");

  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?1 LIMIT 1")
    .bind(userId)
    .first<{ id: string }>();
  if (!user) {
    return notFound(c, "User not found");
  }

  await c.env.DB.prepare(
    "UPDATE users SET suspended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
  )
    .bind(userId)
    .run();

  return c.json({ success: true });
});

adminRoutes.get("/media/moderation", async (c) => {
  const query = moderationListQuerySchema.safeParse({
    status: c.req.query("status"),
    limit: c.req.query("limit"),
  });
  if (!query.success) {
    return badRequest(c, "Invalid moderation query");
  }

  const status = query.data.status;
  const limit = query.data.limit ?? 50;

  const rows = await c.env.DB.prepare(
    `SELECT media_key, media_url, media_type, status, reason, blocked_categories_json, reviewed_by_user_id, reviewed_at, created_at, updated_at
     FROM media_moderation
     WHERE (?1 IS NULL OR status = ?1)
     ORDER BY updated_at DESC
     LIMIT ?2`,
  )
    .bind(status ?? null, limit)
    .all<{
      media_key: string;
      media_url: string;
      media_type: "image" | "video";
      status: MediaModerationStatus;
      reason: string | null;
      blocked_categories_json: string | null;
      reviewed_by_user_id: string | null;
      reviewed_at: string | null;
      created_at: string;
      updated_at: string;
    }>();

  return c.json({
    items: rows.results.map((row) => ({
      mediaKey: row.media_key,
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      status: row.status,
      reason: row.reason,
      blockedCategories: (() => {
        try {
          const parsed = JSON.parse(row.blocked_categories_json ?? "[]");
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })(),
      reviewedByUserId: row.reviewed_by_user_id,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
});

adminRoutes.post("/media/moderation/review", async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = moderationReviewSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid moderation review payload");
  }

  const existing = await c.env.DB.prepare(
    "SELECT media_key FROM media_moderation WHERE media_key = ?1 LIMIT 1",
  )
    .bind(parsed.data.mediaKey)
    .first<{ media_key: string }>();
  if (!existing) {
    return notFound(c, "Media moderation record not found");
  }

  const reason =
    parsed.data.reason?.trim() ||
    (parsed.data.status === "approved"
      ? "Approved by admin review."
      : parsed.data.status === "review"
        ? "Returned to review state by admin."
        : "Rejected by admin review.");

  await c.env.DB.prepare(
    `UPDATE media_moderation
     SET status = ?1,
         reason = ?2,
         reviewed_by_user_id = ?3,
         reviewed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE media_key = ?4`,
  )
    .bind(parsed.data.status, reason, authUser.id, parsed.data.mediaKey)
    .run();

  return c.json({
    success: true,
    mediaKey: parsed.data.mediaKey,
    status: parsed.data.status,
    reason,
  });
});
