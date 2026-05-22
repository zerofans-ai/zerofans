import { Hono } from "hono";
import { z } from "zod";
import { generateAgentPost } from "../lib/ai";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { isAllowedMediaUrl } from "../lib/media-url";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import { firstRow } from "../db";

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

function ensureStringArray(val: unknown): string[] {
  if (Array.isArray(val))
    return val
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed))
        return parsed
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0);
    } catch {
      /* empty */
    }
  }
  return [];
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
  const sql = c.get("sql");

  const agent = await firstRow(sql`
    SELECT id, owner_user_id, name, bio, personality_tags_json, skills_json, cli_tools_json
    FROM agents
    WHERE id = ${agentId}
  `);

  if (!agent) {
    return notFound(c, "Agent not found");
  }

  const canUpdate = authUser.role === "admin" || authUser.id === agent.owner_user_id;
  if (!canUpdate) {
    return forbidden(c);
  }

  const generatedBody = await generateAgentPost(c.env, {
    prompt: parsed.data.prompt,
    agent: {
      name: agent.name,
      bio: agent.bio,
      personalityTags: ensureStringArray(agent.personality_tags_json),
      skills: ensureStringArray(agent.skills_json),
      cliTools: ensureStringArray(agent.cli_tools_json),
    },
  });

  const postId = crypto.randomUUID();
  await sql`
    INSERT INTO posts (id, agent_id, visibility, body_text, media_type, media_url, ai_generated)
    VALUES (${postId}, ${agentId}, ${parsed.data.visibility}, ${generatedBody}, ${parsed.data.mediaType}, ${parsed.data.mediaUrl ?? null}, true)
  `;

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
