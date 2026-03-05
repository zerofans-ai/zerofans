import { Hono } from "hono";
import { z } from "zod";
import { badRequest, unauthorized } from "../lib/http";
import { issueUploadToken, verifyUploadToken } from "../lib/jwt";
import { scanUploadedMedia, upsertMediaModerationRecord } from "../lib/media-moderation";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

const signUploadSchema = z.object({
  filename: z.string().min(1).max(128),
  contentType: z.string().min(1).max(100),
  agentId: z.string().uuid(),
});

const IMAGE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const VIDEO_UPLOAD_MAX_BYTES = 40 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const ALLOWED_VIDEO_CONTENT_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}

function normalizeContentType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getUploadLimitBytes(contentType: string): number | null {
  if (ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return IMAGE_UPLOAD_MAX_BYTES;
  }
  if (ALLOWED_VIDEO_CONTENT_TYPES.has(contentType)) {
    return VIDEO_UPLOAD_MAX_BYTES;
  }
  return null;
}

function getMediaType(contentType: string): "image" | "video" | null {
  if (ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return "image";
  }
  if (ALLOWED_VIDEO_CONTENT_TYPES.has(contentType)) {
    return "video";
  }
  return null;
}

export const uploadsRoutes = new Hono<AppEnv>();

uploadsRoutes.post("/sign", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = signUploadSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid upload payload");
  }

  const ownsAgent = await c.env.DB.prepare(
    "SELECT id FROM agents WHERE id = ?1 AND owner_user_id = ?2 LIMIT 1",
  )
    .bind(parsed.data.agentId, authUser.id)
    .first<{ id: string }>();

  if (!ownsAgent && authUser.role !== "admin") {
    return c.json({ error: "You can only upload for agents you own" }, 403);
  }

  const contentType = normalizeContentType(parsed.data.contentType);
  const maxBytes = getUploadLimitBytes(contentType);
  const mediaType = getMediaType(contentType);
  if (!contentType || !maxBytes) {
    return badRequest(
      c,
      "Unsupported content type. Allowed: image/jpeg, image/png, image/webp, image/avif, video/mp4, video/webm, video/quicktime",
    );
  }

  const key = `agents/${parsed.data.agentId}/${Date.now()}-${sanitizeFilename(parsed.data.filename)}`;
  const token = await issueUploadToken(
    {
      scope: "upload",
      key,
      contentType,
      maxBytes,
    },
    c.env,
  );

  const origin = new URL(c.req.url).origin;
  return c.json({
    key,
    maxBytes,
    mediaType,
    requiresModeration: true,
    uploadUrl: `${origin}/api/uploads/put/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`,
  });
});

uploadsRoutes.put("/put/:key", async (c) => {
  const key = c.req.param("key");
  const token = c.req.query("token");
  if (!token) {
    return unauthorized(c, "Missing upload token");
  }

  const payload = await verifyUploadToken(token, c.env);
  if (!payload || payload.key !== key) {
    return unauthorized(c, "Invalid upload token");
  }

  const contentType = normalizeContentType(c.req.header("content-type") ?? "");
  const mediaType = getMediaType(contentType);
  if (!contentType) {
    return badRequest(c, "Missing Content-Type");
  }
  if (contentType !== payload.contentType) {
    return badRequest(c, "Upload Content-Type does not match signed upload token");
  }
  if (!mediaType) {
    return badRequest(c, "Unsupported media type");
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return badRequest(c, "Empty upload payload");
  }
  if (body.byteLength > payload.maxBytes) {
    return c.json(
      {
        error: `File is too large. Max allowed is ${payload.maxBytes} bytes`,
      },
      413,
    );
  }

  await c.env.MEDIA_BUCKET.put(key, body, {
    httpMetadata: {
      contentType: payload.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      source: "zerofans",
      optimized: "true",
    },
  });

  const mediaUrl = `/media/${key}`;
  const moderation = await scanUploadedMedia(c.env, {
    key,
    mediaUrl,
    mediaType,
    contentType,
    bytes: body,
  });

  await upsertMediaModerationRecord(c.env.DB, {
    mediaKey: key,
    mediaUrl,
    mediaType,
    status: moderation.status,
    reason: moderation.reason,
    blockedCategories: moderation.blockedCategories,
  });

  if (moderation.status === "rejected") {
    await c.env.MEDIA_BUCKET.delete(key);
    return c.json(
      {
        error: moderation.reason ?? "Media rejected by moderation policy",
        key,
        mediaUrl,
        moderationStatus: moderation.status,
      },
      422,
    );
  }

  return c.json({
    key,
    mediaUrl,
    moderationStatus: moderation.status,
    moderationReason: moderation.reason ?? null,
  });
});
