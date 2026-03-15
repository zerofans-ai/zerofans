import { Hono } from "hono";
import { z } from "zod";
import { badRequest, unauthorized } from "../lib/http";
import { issueAccessToken } from "../lib/jwt";
import { hashPassword, verifyPassword } from "../lib/security";
import { requireAuth } from "../middleware/auth";
import type { AppEnv, AuthUser } from "../types/env";

const signupSchema = z.object({
  email: z.string().email(),
  handle: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
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

  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?1 OR handle = ?2 LIMIT 1",
  )
    .bind(email, handle)
    .first<{ id: string }>();

  if (existing) {
    return c.json({ error: "Email or handle already exists" }, 409);
  }

  const userId = crypto.randomUUID();
  const { hash, salt } = await hashPassword(password);

  await c.env.DB.prepare(
    `INSERT INTO users (
      id, email, handle, role, password_hash, password_salt, created_at, updated_at
    ) VALUES (?1, ?2, ?3, 'user', ?4, ?5, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, handle, hash, salt)
    .run();

  const user = {
    id: userId,
    email,
    handle,
    role: "user" as const,
  };
  const token = await issueAccessToken(user, c.env);

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

  const userRow = await c.env.DB.prepare(
    `SELECT id, email, handle, role, password_hash, password_salt, suspended_at
     FROM users WHERE email = ?1 LIMIT 1`,
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      handle: string;
      role: "user" | "admin";
      password_hash: string;
      password_salt: string;
      suspended_at: string | null;
    }>();

  if (!userRow) {
    return unauthorized(c, "Invalid email or password");
  }

  if (userRow.suspended_at) {
    return c.json({ error: "Account is suspended" }, 403);
  }

  const valid = await verifyPassword(
    password,
    userRow.password_salt,
    userRow.password_hash,
  );
  if (!valid) {
    return unauthorized(c, "Invalid email or password");
  }

  const user = formatAuthUser(userRow);
  const token = await issueAccessToken(user, c.env);

  return c.json({ token, user });
});

authRoutes.post("/guest", async (c) => {
  const body = (await c.req.json().catch(() => null)) ?? {};
  const parsed = guestSchema.safeParse(body);

  const rawDeviceId = parsed.success && parsed.data.deviceId ? parsed.data.deviceId : crypto.randomUUID();
  const safeId = rawDeviceId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "");

  const handle = `guest_${safeId.slice(0, 10)}`;
  const email = `${handle}@guest.zerofans`;

  let userRow = await c.env.DB.prepare(
    `SELECT id, email, handle, role
     FROM users
     WHERE handle = ?1
     LIMIT 1`,
  )
    .bind(handle)
    .first<{
      id: string;
      email: string;
      handle: string;
      role: "user" | "admin";
    }>();

  if (!userRow) {
    const passwordSeed = crypto.randomUUID();
    const { hash, salt } = await hashPassword(passwordSeed);
    const userId = crypto.randomUUID();

    await c.env.DB.prepare(
      `INSERT INTO users (
        id, email, handle, role, password_hash, password_salt, created_at, updated_at
      ) VALUES (?1, ?2, ?3, 'user', ?4, ?5, datetime('now'), datetime('now'))`,
    )
      .bind(userId, email, handle, hash, salt)
      .run();

    userRow = {
      id: userId,
      email,
      handle,
      role: "user",
    };
  }

  const user = formatAuthUser(userRow);
  const token = await issueAccessToken(user, c.env);

  return c.json({ token, user });
});

authRoutes.get("/me", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return unauthorized(c);
  }

  const row = await c.env.DB.prepare(
    "SELECT id, email, handle, role, avatar_url, socials_json, created_at FROM users WHERE id = ?1 LIMIT 1",
  )
    .bind(authUser.id)
    .first<{
      id: string;
      email: string;
      handle: string;
      role: "user" | "admin";
      avatar_url: string | null;
      socials_json: string | null;
      created_at: string;
    }>();

  if (!row) {
    return unauthorized(c);
  }

  let socials: Array<{ platform: string; url: string }> = [];
  try {
    const parsed = JSON.parse(row.socials_json ?? "[]");
    if (Array.isArray(parsed)) socials = parsed;
  } catch { /* empty */ }

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

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (parsed.data.avatarUrl !== undefined) {
    updates.push("avatar_url = ?");
    values.push(parsed.data.avatarUrl);
  }
  if (parsed.data.socials !== undefined) {
    updates.push("socials_json = ?");
    values.push(JSON.stringify(parsed.data.socials));
  }

  if (updates.length === 0) {
    return badRequest(c, "No fields to update");
  }

  updates.push("updated_at = datetime('now')");

  await c.env.DB.prepare(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
  )
    .bind(...values, authUser.id)
    .run();

  return c.json({ success: true });
});
