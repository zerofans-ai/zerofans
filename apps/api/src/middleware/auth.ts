import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { parseBearerToken, unauthorized } from "../lib/http";
import { verifyAccessToken } from "../lib/jwt";
import { hashAgentToken } from "../lib/agent-auth";
import { firstRow } from "../db";
import { agentTokens } from "../db/schema";
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

    if (!row) return null;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return null;

    return {
      id: row.id,
      agentId: row.agentId,
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
