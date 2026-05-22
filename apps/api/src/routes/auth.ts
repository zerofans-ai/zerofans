import { Hono } from "hono";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import { badRequest, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import { issueAccessToken } from "../lib/jwt";
import {
  hashPassword,
  verifyPassword,
  rehashPassword,
} from "../lib/security";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";
import type { AppEnv, AuthUser } from "../types/env";

const MINIMUM_AGE = 13;

const signupSchema = z.object({
  email: z.string().email(),
  handle: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  dateOfBirth: z.string().optional(),
  termsAccepted: z.boolean().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const guestSchema = z.object({
  deviceId: z.string().min(8).max(128).optional(),
});

const socialLinkSchema = z.object({
  platform: z.string().min(1).max(30),
  url: z.string().url().max(500),
});

const updateProfileSchema = z.object({
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  socials: z.array(socialLinkSchema).max(10).optional(),
});

function formatAuthUser(row: {
  id: string;
  email: string;
  handle: string;
  role: "user" | "admin";
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    role: row.role,
  };
}

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getDate() < birth.getDate())
  ) {
    age--;
  }
  return age;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid signup payload");
  }

  const email = parsed.data.email.trim().toLowerCase();
  const handle = parsed.data.handle.trim().toLowerCase();
  const password = parsed.data.password;
  const sql = c.get("sql");

  // Age gate (COPPA)
  let dateOfBirth: string | null = null;
  if (parsed.data.dateOfBirth) {
    const age = calculateAge(parsed.data.dateOfBirth);
    if (age < MINIMUM_AGE) {
      return badRequest(c, `You must be at least ${MINIMUM_AGE} years old`);
    }
    dateOfBirth = parsed.data.dateOfBirth;
  }

  const existing = await firstRow(sql`
    SELECT id FROM users WHERE lower(email) = lower(${email}) OR lower(handle) = lower(${handle})
  `);

  if (existing) {
    return c.json({ error: "Email or handle already exists" }, 409);
  }

  const userId = crypto.randomUUID();
  const { hash } = await hashPassword(password);
  const now = new Date();

  await sql`
    INSERT INTO users (id, email, handle, password_hash, password_salt, date_of_birth, terms_accepted_at, privacy_accepted_at)
    VALUES (${userId}, ${email}, ${handle}, ${hash}, NULL, ${dateOfBirth}, ${parsed.data.termsAccepted ? now : null}, ${parsed.data.termsAccepted ? now : null})
  `;

  const user = { id: userId, email, handle, role: "user" as const };
  const token = await issueAccessToken(user, c.env);

  await writeAuditLog(sql, {
    actorUserId: userId,
    action: "account_created",
    targetType: "user",
    targetId: userId,
  });

  return c.json({ token, user });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid login payload");
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;
  const sql = c.get("sql");

  const userRow = await firstRow(sql`
    SELECT * FROM users WHERE lower(email) = lower(${email})
  `);

  if (
    !userRow ||
    !userRow.password_hash
  ) {
    return unauthorized(c, "Invalid email or password");
  }

  if (userRow.suspended_at) {
    return c.json({ error: "Account is suspended" }, 403);
  }

  const { valid, needsRehash } = await verifyPassword(
    password,
    userRow.password_salt,
    userRow.password_hash,
  );

  if (!valid) {
    return unauthorized(c, "Invalid email or password");
  }

  // Upgrade legacy SHA-256 to bcrypt on login
  if (needsRehash) {
    const { hash: newHash } = await rehashPassword(password);
    await sql`
      UPDATE users SET password_hash = ${newHash}, password_salt = NULL WHERE id = ${userRow.id}
    `;
  }

  const user = formatAuthUser(userRow as { id: string; email: string; handle: string; role: "user" | "admin" });
  const token = await issueAccessToken(user, c.env);

  return c.json({ token, user });
});

authRoutes.post("/guest", async (c) => {
  const body = (await c.req.json().catch(() => null)) ?? {};
  const parsed = guestSchema.safeParse(body);
  const sql = c.get("sql");

  const rawDeviceId =
    parsed.success && parsed.data.deviceId
      ? parsed.data.deviceId
      : crypto.randomUUID();
  const safeId =
    rawDeviceId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
    crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "");

  const handle = `guest_${safeId.slice(0, 10)}`;
  const email = `${handle}@guest.zerofans`;

  let userRow = await firstRow(sql`
    SELECT * FROM users WHERE handle = ${handle}
  `);

  if (!userRow) {
    const passwordSeed = crypto.randomUUID();
    const { hash } = await hashPassword(passwordSeed);
    const userId = crypto.randomUUID();

    await sql`
      INSERT INTO users (id, email, handle, password_hash)
      VALUES (${userId}, ${email}, ${handle}, ${hash})
    `;

    userRow = {
      id: userId,
      email,
      handle,
      role: "user" as const,
    } as Record<string, unknown>;
  }

  const user = formatAuthUser(userRow as { id: string; email: string; handle: string; role: "user" | "admin" });
  const token = await issueAccessToken(user, c.env);

  return c.json({ token, user });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }
  const sql = c.get("sql");

  const row = await firstRow(sql`
    SELECT * FROM users WHERE id = ${authUser.id}
  `);

  if (!row) {
    return unauthorized(c);
  }

  let socials: Array<{ platform: string; url: string }> = [];
  if (Array.isArray(row.socials_json)) {
    socials = row.socials_json;
  } else if (typeof row.socials_json === "string") {
    try {
      const parsed = JSON.parse(row.socials_json);
      if (Array.isArray(parsed)) socials = parsed;
    } catch {
      /* empty */
    }
  }

  return c.json({
    user: {
      id: row.id,
      email: row.email,
      handle: row.handle,
      role: row.role,
      avatar_url: row.avatar_url,
      socials,
      created_at: row.created_at,
    },
  });
});

authRoutes.patch("/me", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(c, "Invalid profile update payload");
  }

  const sql = c.get("sql");
  const hasAvatar = parsed.data.avatarUrl !== undefined;
  const hasSocials = parsed.data.socials !== undefined;

  if (!hasAvatar && !hasSocials) {
    return badRequest(c, "No fields to update");
  }

  if (hasAvatar && hasSocials) {
    await sql`
      UPDATE users SET avatar_url = ${parsed.data.avatarUrl}, socials_json = ${JSON.stringify(parsed.data.socials!)}::jsonb
      WHERE id = ${authUser.id}
    `;
  } else if (hasAvatar) {
    await sql`
      UPDATE users SET avatar_url = ${parsed.data.avatarUrl} WHERE id = ${authUser.id}
    `;
  } else {
    await sql`
      UPDATE users SET socials_json = ${JSON.stringify(parsed.data.socials!)}::jsonb WHERE id = ${authUser.id}
    `;
  }

  await writeAuditLog(sql, {
    actorUserId: authUser.id,
    action: "profile_updated",
    targetType: "user",
    targetId: authUser.id,
  });

  return c.json({ success: true });
});

// ── Compliance: Data Export (CCPA Right to Know) ───────────────────────

authRoutes.get("/me/export", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);
  const sql = c.get("sql");

  const userRow = await firstRow(sql`
    SELECT * FROM users WHERE id = ${authUser.id}
  `);
  if (!userRow) return unauthorized(c);

  const userAgents = await sql`
    SELECT * FROM agents WHERE owner_user_id = ${authUser.id}
  `;

  const agentIds = userAgents.map((a: Record<string, unknown>) => a.id as string);

  let userPosts: Record<string, unknown>[] = [];
  if (agentIds.length > 0) {
    userPosts = await sql`
      SELECT * FROM posts WHERE agent_id = ANY(${agentIds})
    `;
  }

  const userComments = await sql`
    SELECT * FROM comments WHERE user_id = ${authUser.id}
  `;

  const userLikes = await sql`
    SELECT * FROM likes WHERE user_id = ${authUser.id}
  `;

  const userFollows = await sql`
    SELECT * FROM follows WHERE user_id = ${authUser.id}
  `;

  const userSubs = await sql`
    SELECT * FROM subscriptions WHERE user_id = ${authUser.id}
  `;

  const userCommunityMemberships = await sql`
    SELECT * FROM community_members WHERE user_id = ${authUser.id}
  `;

  let userEquippedSkills: Record<string, unknown>[] = [];
  if (agentIds.length > 0) {
    userEquippedSkills = await sql`
      SELECT * FROM agent_skills WHERE agent_id = ANY(${agentIds})
    `;
  }

  await writeAuditLog(sql, {
    actorUserId: authUser.id,
    action: "data_export",
    targetType: "user",
    targetId: authUser.id,
  });

  return c.json({
    exported_at: new Date().toISOString(),
    profile: {
      id: userRow.id,
      email: userRow.email,
      handle: userRow.handle,
      role: userRow.role,
      avatar_url: userRow.avatar_url,
      created_at: userRow.created_at,
    },
    agents: userAgents,
    posts: userPosts,
    comments: userComments,
    likes: userLikes,
    follows: userFollows,
    subscriptions: userSubs,
    community_memberships: userCommunityMemberships,
    equipped_skills: userEquippedSkills,
  });
});

// ── Compliance: Account Deletion (CCPA Right to Delete) ────────────────

authRoutes.delete("/me/account", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);
  const sql = c.get("sql");

  // Note: neon serverless does not support transactions natively.
  // We execute deletes sequentially. If a partial failure occurs, some data may remain.
  // For full transactional safety, a pooled connection or migration to a transaction-supporting driver is needed.

  const userAgents = await sql`
    SELECT id FROM agents WHERE owner_user_id = ${authUser.id}
  `;
  const agentIds = userAgents.map((a: Record<string, unknown>) => a.id as string);

  // Write audit log before user is deleted (FK dependency)
  await writeAuditLog(sql, {
    actorUserId: authUser.id,
    action: "account_deleted",
    targetType: "user",
    targetId: authUser.id,
  });

  // Cascade delete agent-related data
  if (agentIds.length > 0) {
    await sql`
      DELETE FROM skill_execution_logs WHERE agent_id = ANY(${agentIds})
    `;
    await sql`
      DELETE FROM agent_skills WHERE agent_id = ANY(${agentIds})
    `;
    await sql`
      DELETE FROM agent_relationships WHERE source_agent_id = ANY(${agentIds}) OR target_agent_id = ANY(${agentIds})
    `;
    await sql`
      DELETE FROM posts WHERE agent_id = ANY(${agentIds})
    `;
    await sql`
      DELETE FROM agent_communities WHERE agent_id = ANY(${agentIds})
    `;
    await sql`
      DELETE FROM agents WHERE id = ANY(${agentIds})
    `;
  }

  // Delete user-level data
  await sql`
    DELETE FROM community_messages WHERE user_id = ${authUser.id}
  `;
  await sql`
    DELETE FROM community_members WHERE user_id = ${authUser.id}
  `;
  await sql`
    DELETE FROM comments WHERE user_id = ${authUser.id}
  `;
  await sql`
    DELETE FROM likes WHERE user_id = ${authUser.id}
  `;
  await sql`
    DELETE FROM follows WHERE user_id = ${authUser.id}
  `;
  await sql`
    DELETE FROM subscriptions WHERE user_id = ${authUser.id}
  `;

  // Finally, delete the user
  await sql`
    DELETE FROM users WHERE id = ${authUser.id}
  `;

  return c.json({ success: true, message: "Account and all data deleted" });
});

// ── X (Twitter) OAuth 2.0 ──────────────────────────────────────────────

const encoder = new TextEncoder();

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(input));
}

function getSecret(secret: string): Uint8Array {
  return encoder.encode(secret);
}

authRoutes.get("/twitter", async (c) => {
  const clientId = c.env.TWITTER_CLIENT_ID;
  const clientSecret = c.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return badRequest(c, "Twitter OAuth is not configured");
  }

  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challengeBuf = await sha256(codeVerifier);
  const codeChallenge = base64url(challengeBuf);

  const state = await new SignJWT({ cv: codeVerifier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(c.env.JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecret(c.env.JWT_SECRET));

  const siteUrl = (c.env.SITE_URL || `https://${new URL(c.req.url).host}`).replace(/\/+$/, "");
  const redirectUri = `${siteUrl}/api/auth/twitter/callback`;

  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "tweet.read users.read");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return c.redirect(url.toString());
});

authRoutes.get("/twitter/callback", async (c) => {
  const clientId = c.env.TWITTER_CLIENT_ID;
  const clientSecret = c.env.TWITTER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return badRequest(c, "Twitter OAuth is not configured");
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    const siteUrl = (c.env.SITE_URL || `https://${new URL(c.req.url).host}`).replace(/\/+$/, "");
    return c.redirect(`${siteUrl}/auth?oauth_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return badRequest(c, "Missing code or state");
  }

  // Recover code_verifier from state JWT
  let codeVerifier: string;
  try {
    const { payload } = await jwtVerify(state, getSecret(c.env.JWT_SECRET), {
      issuer: c.env.JWT_ISSUER,
    });
    codeVerifier = payload.cv as string;
    if (!codeVerifier) throw new Error("missing cv");
  } catch {
    return unauthorized(c, "Invalid OAuth state");
  }

  const siteUrl = (c.env.SITE_URL || `https://${new URL(c.req.url).host}`).replace(/\/+$/, "");
  const redirectUri = `${siteUrl}/api/auth/twitter/callback`;

  // Exchange code for token
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Twitter token exchange failed:", body);
    return unauthorized(c, "Twitter authentication failed");
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  const accessToken = tokenData.access_token;

  // Fetch X user profile
  const userRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userRes.ok) {
    return unauthorized(c, "Failed to fetch Twitter profile");
  }

  const userData = (await userRes.json()) as {
    data: { id: string; name: string; username: string };
  };
  const twitterId = userData.data.id;
  const twitterHandle = userData.data.username;
  const twitterName = userData.data.name;

  const sql = c.get("sql");

  // Look up existing user by twitter_id
  let userRow = await firstRow(sql`
    SELECT id, email, handle, role FROM users WHERE twitter_id = ${twitterId}
  `);

  let user: AuthUser;

  if (userRow) {
    // Update handle/avatar on each login
    await sql`
      UPDATE users SET twitter_handle = ${twitterHandle}, updated_at = now() WHERE id = ${userRow.id}
    `;
    user = {
      id: userRow.id as string,
      email: userRow.email as string,
      handle: userRow.handle as string,
      role: (userRow.role as "user" | "admin") ?? "user",
    };
  } else {
    // Create new user
    let handle = twitterHandle.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "");
    if (handle.length < 3) handle = `x_${handle}`;
    if (handle.length > 30) handle = handle.slice(0, 30);

    let finalHandle = handle;
    let suffix = 1;
    while (await firstRow(sql`SELECT id FROM users WHERE handle = ${finalHandle}`)) {
      finalHandle = `${handle}_${suffix++}`;
    }

    const userId = crypto.randomUUID();
    const { hash } = await hashPassword(crypto.randomUUID());
    const email = `twitter_${twitterId}@oauth.zerofans`;

    await sql`
      INSERT INTO users (id, email, handle, password_hash, twitter_id, twitter_handle, auth_provider)
      VALUES (${userId}, ${email}, ${finalHandle}, ${hash}, ${twitterId}, ${twitterHandle}, 'twitter')
    `;

    user = { id: userId, email, handle: finalHandle, role: "user" };

    await writeAuditLog(sql, {
      actorUserId: userId,
      action: "account_created_twitter",
      targetType: "user",
      targetId: userId,
    });
  }

  const token = await issueAccessToken(user, c.env);

  return c.redirect(`${siteUrl}/auth?token=${encodeURIComponent(token)}`);
});
