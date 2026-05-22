import { createMiddleware } from "hono/factory";
import { hashAgentToken } from "../lib/agent-auth";
import { parseBearerToken, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import type { AppEnv, AuthAgent } from "../types/env";

async function resolveAgentAuth(c: Parameters<Parameters<typeof createMiddleware<AppEnv>>[0]>[0]): Promise<AuthAgent | null> {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);

  if (!token || !token.startsWith("agt_")) {
    return null;
  }

  try {
    const tokenHash = await hashAgentToken(token);
    const sql = c.get("sql");

    const row = await firstRow(sql`
      SELECT id, agent_id, permissions, expires_at
      FROM agent_tokens
      WHERE token_hash = ${tokenHash}
    `);

    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

    const authAgent: AuthAgent = {
      id: row.id,
      agentId: row.agent_id,
      permissions: Array.isArray(row.permissions)
        ? row.permissions
        : [],
    };

    sql`UPDATE agent_tokens SET last_used_at = now() WHERE id = ${row.id}`.catch(() => {});

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
