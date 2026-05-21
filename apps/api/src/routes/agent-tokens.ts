import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { generateAgentToken, hashAgentToken } from "../lib/agent-auth";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";
import type { Database } from "../db";
import { firstRow } from "../db";
import { agents, agentTokens } from "../db/schema";

const createTokenSchema = z.object({
  name: z.string().min(1).max(80),
  permissions: z.array(z.string()).max(20).optional(),
  expiresAt: z.string().datetime().optional(),
});

async function verifyAgentOwnership(
  db: Database,
  agentId: string,
  userId: string,
  userRole: string,
): Promise<boolean> {
  if (userRole === "admin") return true;
  const agent = await firstRow(
    db
      .select({ ownerUserId: agents.ownerUserId })
      .from(agents)
      .where(eq(agents.id, agentId)),
  );
  return agent?.ownerUserId === userId;
}

export const agentTokenRoutes = new Hono<AppEnv>();

// Create agent token
agentTokenRoutes.post("/:agentId/tokens", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const agentId = c.req.param("agentId");
  const db = c.get("db");

  const isOwner = await verifyAgentOwnership(db, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only create tokens for your own agent");

  const body = await c.req.json().catch(() => null);
  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid token payload");

  const plainToken = await generateAgentToken();
  const tokenHash = await hashAgentToken(plainToken);

  const id = crypto.randomUUID();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  await db.insert(agentTokens).values({
    id,
    agentId,
    tokenHash,
    name: parsed.data.name.trim(),
    permissions: parsed.data.permissions ?? [],
    expiresAt,
  });

  return c.json({
    token: {
      id,
      agentId,
      name: parsed.data.name.trim(),
      permissions: parsed.data.permissions ?? [],
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
  const db = c.get("db");

  const isOwner = await verifyAgentOwnership(db, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only list tokens for your own agent");

  const rows = await db
    .select({
      id: agentTokens.id,
      agentId: agentTokens.agentId,
      name: agentTokens.name,
      permissions: agentTokens.permissions,
      lastUsedAt: agentTokens.lastUsedAt,
      expiresAt: agentTokens.expiresAt,
      createdAt: agentTokens.createdAt,
    })
    .from(agentTokens)
    .where(eq(agentTokens.agentId, agentId));

  return c.json({ items: rows });
});

// Revoke (delete) agent token
agentTokenRoutes.delete("/:agentId/tokens/:tokenId", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const agentId = c.req.param("agentId");
  const tokenId = c.req.param("tokenId");
  const db = c.get("db");

  const isOwner = await verifyAgentOwnership(db, agentId, authUser.id, authUser.role);
  if (!isOwner) return forbidden(c, "You can only revoke tokens for your own agent");

  const token = await firstRow(
    db
      .select({ id: agentTokens.id })
      .from(agentTokens)
      .where(
        and(eq(agentTokens.id, tokenId), eq(agentTokens.agentId, agentId)),
      ),
  );

  if (!token) return notFound(c, "Token not found");

  await db.delete(agentTokens).where(eq(agentTokens.id, tokenId));

  return c.json({ success: true });
});
