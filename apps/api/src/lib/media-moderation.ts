import type { EnvBindings } from "../types/env";

export type MediaModerationStatus = "pending" | "approved" | "rejected" | "review";
export type ModeratedMediaType = "image" | "video";

export interface MediaModerationDecision {
  allowed: boolean;
  reason?: string;
  status?: MediaModerationStatus;
}

export interface UploadedMediaScanInput {
  key: string;
  mediaUrl: string;
  mediaType: ModeratedMediaType;
  contentType: string;
  bytes: ArrayBuffer;
}

export interface UploadedMediaScanResult {
  status: MediaModerationStatus;
  reason?: string;
  blockedCategories?: string[];
}

const MAX_INLINE_IMAGE_MODERATION_BYTES = 1_500_000;

function moderationDisabled(env: EnvBindings): boolean {
  return env.CONTENT_MODERATION_DISABLED === "1";
}

function failClosed(env: EnvBindings): boolean {
  return env.CONTENT_MODERATION_FAIL_CLOSED !== "0";
}

function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function normalizeSiteUrl(siteUrl: string | undefined): string | null {
  if (!siteUrl) {
    return null;
  }

  try {
    const parsed = new URL(siteUrl);
    const isLoopback =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    if (isLoopback) {
      return null;
    }
    return trimTrailingSlash(parsed.toString());
  } catch {
    return null;
  }
}

function toDataUrl(contentType: string, bytes: ArrayBuffer): string {
  const buffer = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    const chunk = buffer.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return `data:${contentType};base64,${base64}`;
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

async function moderateImageWithVision(
  env: EnvBindings,
  input: UploadedMediaScanInput,
): Promise<UploadedMediaScanResult> {
  if (!env.AI_API_KEY) {
    if (failClosed(env)) {
      return {
        status: "review",
        reason: "Media pending manual review because AI moderation credentials are not configured.",
      };
    }
    return { status: "approved" };
  }

  const baseUrl = env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = env.AI_MODEL ?? "gpt-4.1-mini";

  const siteUrl = normalizeSiteUrl(env.SITE_URL);
  const imageInput =
    siteUrl
      ? `${siteUrl}/media/${input.key}`
      : input.bytes.byteLength <= MAX_INLINE_IMAGE_MODERATION_BYTES
        ? toDataUrl(input.contentType, input.bytes)
        : null;

  if (!imageInput) {
    return {
      status: "review",
      reason:
        "Media pending manual review because image could not be safely attached for automated moderation.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a safety classifier. Determine whether an image contains sexual content or nudity. Return strict JSON: {\"allowed\": boolean, \"reason\": string, \"categories\": string[]}. Mark allowed=false for any explicit sexual content or nudity.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Classify this uploaded media for nudity/sexual content policy compliance.",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageInput,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision moderation request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      throw new Error("Vision moderation returned empty content");
    }

    const jsonContent = extractFirstJsonObject(rawContent) ?? rawContent;
    const parsed = JSON.parse(jsonContent) as {
      allowed?: unknown;
      reason?: unknown;
      categories?: unknown;
    };

    if (typeof parsed.allowed !== "boolean") {
      throw new Error("Vision moderation response missing boolean 'allowed'");
    }

    if (parsed.allowed) {
      return { status: "approved" };
    }

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : "Media rejected by safety policy.";
    const blockedCategories = Array.isArray(parsed.categories)
      ? parsed.categories.map((value) => String(value))
      : [];

    return {
      status: "rejected",
      reason,
      blockedCategories,
    };
  } catch (error) {
    console.error("Image moderation failed", error);
    if (failClosed(env)) {
      return {
        status: "review",
        reason: "Media pending manual review because automated moderation is unavailable.",
      };
    }
    return { status: "approved" };
  }
}

export function extractMediaKeyFromUrl(mediaUrl: string): string | null {
  if (!mediaUrl) {
    return null;
  }

  if (mediaUrl.startsWith("/media/")) {
    return mediaUrl.slice("/media/".length);
  }

  try {
    const parsed = new URL(mediaUrl);
    if (!parsed.pathname.startsWith("/media/")) {
      return null;
    }
    return parsed.pathname.slice("/media/".length);
  } catch {
    return null;
  }
}

export async function ensureMediaApprovedForPublish(
  db: D1Database,
  mediaType: "image" | "video" | "none",
  mediaUrl: string | null | undefined,
): Promise<MediaModerationDecision> {
  if (mediaType === "none") {
    return { allowed: true };
  }

  if (!mediaUrl) {
    return { allowed: false, reason: "Media URL is required for non-text posts." };
  }

  const mediaKey = extractMediaKeyFromUrl(mediaUrl);
  if (!mediaKey) {
    return {
      allowed: false,
      reason: "Only uploaded media hosted on this service can be attached to posts.",
    };
  }

  const record = await db
    .prepare("SELECT status, reason FROM media_moderation WHERE media_key = ?1 LIMIT 1")
    .bind(mediaKey)
    .first<{ status: MediaModerationStatus; reason: string | null }>();

  if (!record) {
    return {
      allowed: false,
      reason: "Media is missing moderation status. Re-upload media and try again.",
    };
  }

  if (record.status === "approved") {
    return { allowed: true, status: "approved" };
  }

  if (record.status === "review" || record.status === "pending") {
    return {
      allowed: false,
      reason:
        record.reason ??
        "Media is still pending review. Publishing is blocked until moderation completes.",
      status: record.status,
    };
  }

  return {
    allowed: false,
    reason: record.reason ?? "Media was rejected by safety policy.",
    status: "rejected",
  };
}

export async function upsertMediaModerationRecord(
  db: D1Database,
  payload: {
    mediaKey: string;
    mediaUrl: string;
    mediaType: ModeratedMediaType;
    status: MediaModerationStatus;
    reason?: string;
    blockedCategories?: string[];
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO media_moderation (
        media_key, media_url, media_type, status, reason, blocked_categories_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'))
      ON CONFLICT(media_key) DO UPDATE SET
        media_url = excluded.media_url,
        media_type = excluded.media_type,
        status = excluded.status,
        reason = excluded.reason,
        blocked_categories_json = excluded.blocked_categories_json,
        updated_at = datetime('now')`,
    )
    .bind(
      payload.mediaKey,
      payload.mediaUrl,
      payload.mediaType,
      payload.status,
      payload.reason ?? null,
      JSON.stringify(payload.blockedCategories ?? []),
    )
    .run();
}

export async function scanUploadedMedia(
  env: EnvBindings,
  input: UploadedMediaScanInput,
): Promise<UploadedMediaScanResult> {
  if (moderationDisabled(env)) {
    return { status: "approved" };
  }

  if (input.mediaType === "video") {
    return {
      status: "review",
      reason:
        "Video upload quarantined for manual review. Approve via admin moderation review endpoint.",
    };
  }

  return moderateImageWithVision(env, input);
}
