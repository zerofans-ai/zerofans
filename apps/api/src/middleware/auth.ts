import { createMiddleware } from "hono/factory";
import { parseBearerToken, unauthorized } from "../lib/http";
import { verifyAccessToken } from "../lib/jwt";
import { hashAgentToken } from "../lib/agent-auth";
import { firstRow } from "../db";
import type { AppEnv, AuthAgent } from "../types/env";

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);

  if (!token) {
    c.set("authUser", null);
    c.set("authAgent", null);
    await next();
    return;
  }

  if (token.startsWith("agt_")) {
    c.set("authUser", null);
    c.set("authAgent", await resolveAgentToken(token, c));
  } else {
    c.set("authUser", await verifyAccessToken(token, c.env));
    c.set("authAgent", null);
  }

  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = parseBearerToken(header);
  if (!token) {
    return unauthorized(c);
  }

  if (token.startsWith("agt_")) {
    const authAgent = await resolveAgentToken(token, c);
    if (!authAgent) {
      return unauthorized(c, "Invalid or expired agent token");
    }
    c.set("authUser", null);
    c.set("authAgent", authAgent);
  } else {
    const user = await verifyAccessToken(token, c.env);
    if (!user) {
      return unauthorized(c);
    }
    c.set("authUser", user);
    c.set("authAgent", null);
  }

  await next();
});

async function resolveAgentToken(token: string, c: Parameters<Parameters<typeof createMiddleware<AppEnv>>[0]>[0]): Promise<AuthAgent | null> {
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

    return {
      id: row.id,
      agentId: row.agent_id,
      permissions: Array.isArray(row.permissions)
        ? (row.permissions as string[]).join(",")
        : typeof row.permissions === "string"
          ? row.permissions
          : "read",
    };
  } catch {
    return null;
  }
}
