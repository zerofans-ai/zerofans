import { Hono } from "hono";
import { z } from "zod";
import { generateAgentPost } from "../lib/ai";
import { moderateContent } from "../lib/content-moderation";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { ensureMediaApprovedForPublish } from "../lib/media-moderation";
import { isAllowedMediaUrl } from "../lib/media-url";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

const mediaUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => isAllowedMediaUrl(value), {
    message: "Invalid media URL",
  });

const aiUpdateSchema = z.object({
  prompt: z.string().max(500).optional(),
  visibility: z.enum(["public", "subscriber"]).default("public"),
  mediaType: z.enum(["image", "video", "none"]).default("none"),
  mediaUrl: mediaUrlSchema.nullable().optional(),
});

export const aiRoutes = new Hono<AppEnv>();

function parseStringArray(serialized: string | null): string[] {
  try {
    const parsed = JSON.parse(serialized ?? "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

aiRoutes.post("/agents/:agentId/update-content", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = aiUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid AI content payload");
  }

  const agentId = c.req.param("agentId");
  const agent = await c.env.DB.prepare(
    `SELECT id, owner_user_id, name, bio, personality_tags_json, skills_json, cli_tools_json
     FROM agents WHERE id = ?1 LIMIT 1`,
  )
    .bind(agentId)
    .first<{
      id: string;
      owner_user_id: string;
      name: string;
      bio: string | null;
      personality_tags_json: string | null;
      skills_json: string | null;
      cli_tools_json: string | null;
    }>();

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const canUpdate = authUser.role === "admin" || authUser.id === agent.owner_user_id;
  if (!canUpdate) {
    return forbidden(c);
  }

  const mediaDecision = await ensureMediaApprovedForPublish(
    c.env.DB,
    parsed.data.mediaType,
    parsed.data.mediaUrl ?? null,
  );
  if (!mediaDecision.allowed) {
    return c.json({ error: mediaDecision.reason ?? "Media moderation check failed" }, 422);
  }

  const promptModeration = await moderateContent(c.env, {
    text: parsed.data.prompt ?? null,
    mediaUrl: parsed.data.mediaUrl ?? null,
  });
  if (!promptModeration.allowed) {
    return c.json(
      { error: promptModeration.reason ?? "Prompt blocked by moderation policy" },
      422,
    );
  }

  const generatedBody = await generateAgentPost(c.env, {
    prompt: parsed.data.prompt,
    agent: {
      name: agent.name,
      bio: agent.bio,
      personalityTags: parseStringArray(agent.personality_tags_json),
      skills: parseStringArray(agent.skills_json),
      cliTools: parseStringArray(agent.cli_tools_json),
    },
  });

  const generatedModeration = await moderateContent(c.env, {
    text: generatedBody,
    mediaUrl: parsed.data.mediaUrl ?? null,
  });
  if (!generatedModeration.allowed) {
    return c.json(
      { error: generatedModeration.reason ?? "Generated content blocked by moderation policy" },
      422,
    );
  }

  const postId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO posts (
      id, agent_id, visibility, body_text, media_type, media_url, ai_generated, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, datetime('now'), datetime('now'))`,
  )
    .bind(
      postId,
      agentId,
      parsed.data.visibility,
      generatedBody,
      parsed.data.mediaType,
      parsed.data.mediaUrl ?? null,
    )
    .run();

  return c.json({
    post: {
      id: postId,
      agentId,
      bodyText: generatedBody,
      visibility: parsed.data.visibility,
      mediaType: parsed.data.mediaType,
      mediaUrl: parsed.data.mediaUrl ?? null,
      aiGenerated: true,
    },
  });
});
