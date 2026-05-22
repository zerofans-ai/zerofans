import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, unauthorized } from "../lib/http";
import { generateAgentToken, hashAgentToken } from "../lib/agent-auth";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { Sql } from "../db";
import { firstRow } from "../db";

const createTokenSchema = z.object({
  name: z.string().min(1).max(80),
  permissions: z.array(z.string()).max(20).optional(),
  expiresAt: z.string().datetime().optional(),
});

async function verifyAgentOwnership(
  sql: Sql,
  agentId: string,
  userId: string,
  userRole: string,
): Promise<boolean> {
  if (userRole === "admin") return true;
  const agent = await firstRow(sql`
    SELECT owner_user_id FROM agents WHERE id = ${agentId}
  `);
  return agent?.owner_user_id === userId;
}

export const agentTokenRoutes = new Hono<AppEnv>();

// Create agent token
agentTokenRoutes.post("/:agentId/tokens", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const isOwner = await verifyAgentOwnership(sql, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only create tokens for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid token payload");

  const plainToken = await generateAgentToken();
  const tokenHash = await hashAgentToken(plainToken);

  const id = crypto.randomUUID();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  const permissions = parsed.data.permissions ?? [];

  await sql`
    INSERT INTO agent_tokens (id, agent_id, token_hash, name, permissions, expires_at)
    VALUES (${id}, ${agentId}, ${tokenHash}, ${parsed.data.name.trim()}, ${JSON.stringify(permissions)}::jsonb, ${expiresAt})
  `;

  return c.json({
    token: {
      id,
      agentId,
      name: parsed.data.name.trim(),
      permissions,
      expiresAt,
      // The plain token is only returned once
      plainToken,
    },
  });
});

// List agent tokens
agentTokenRoutes.get("/:agentId/tokens", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const agentId = c.req.param("agentId");
  const sql = c.get("sql");

  const isOwner = await verifyAgentOwnership(sql, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only list tokens for your own agent");

  const rows = await sql`
    SELECT id, agent_id, name, permissions, last_used_at, expires_at, created_at
    FROM agent_tokens
    WHERE agent_id = ${agentId}
  `;

  return c.json({ items: rows });
});

// Revoke (delete) agent token
agentTokenRoutes.delete("/:agentId/tokens/:tokenId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const agentId = c.req.param("agentId");
  const tokenId = c.req.param("tokenId");
  const sql = c.get("sql");

  const isOwner = await verifyAgentOwnership(sql, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only revoke tokens for your own agent");

  const token = await firstRow(sql`
    SELECT id FROM agent_tokens WHERE id = ${tokenId} AND agent_id = ${agentId}
  `);

  if (!token) return badRequest(c, "Token not found");

  await sql`
    DELETE FROM agent_tokens WHERE id = ${tokenId}
  `;

  return c.json({ success: true });
});
