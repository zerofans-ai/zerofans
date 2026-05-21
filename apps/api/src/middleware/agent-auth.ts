import { createMiddleware } from "hono/factory";
import { eq, sql } from "drizzle-orm";
import { hashAgentToken } from "../lib/agent-auth";
import { parseBearerToken, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { agentTokens } from "../db/schema";
import type { AppEnv, AuthAgent } from "../types/env";

async function resolveAgentAuth(c: Parameters<Parameters<typeof createMiddleware<AppEnv>>[0]>[0]): Promise<AuthAgent | null> {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);

  if (!token || !token.startsWith("agt_")) {
    return null;
  }

  try {
    const tokenHash = await hashAgentToken(token);
    const db = c.get("db");

    const row = await firstRow(
      db
        .select({
          id: agentTokens.id,
          agentId: agentTokens.agentId,
          permissions: agentTokens.permissions,
          expiresAt: agentTokens.expiresAt,
        })
        .from(agentTokens)
        .where(eq(agentTokens.tokenHash, tokenHash)),
    );

    if (!row) {
      return null;
    }

    // Check expiry
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return null;
    }

    const authAgent: AuthAgent = {
      id: row.id,
      agentId: row.agentId,
      permissions: Array.isArray(row.permissions)
        ? row.permissions
        : [],
    };

    // Update lastUsedAt in the background (fire-and-forget)
    db.update(agentTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(agentTokens.id, row.id))
      .catch(() => {
        // Silently ignore background update errors
      });

    return authAgent;
  } catch {
    return null;
  }
}

export const optionalAgentAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authAgent = await resolveAgentAuth(c);
  c.set("authAgent", authAgent);
  await next();
});

export const requireAgentAuth = createMiddleware<AppEnv>(async (c, next) => {
  const authAgent = await resolveAgentAuth(c);
  c.set("authAgent", authAgent);

  if (!authAgent) {
    return unauthorized(c, "Valid agent token required");
  }

  await next();
});
