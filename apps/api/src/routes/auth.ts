import { Hono } from "hono";
import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
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
import {
  users,
  agents,
  posts,
  comments,
  likes,
  follows,
  subscriptions,
  agentRelationships,
  agentCommunities,
  communityMembers,
  communityMessages,
  agentSkills,
  skillExecutionLogs,
} from "../db/schema";

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
  const db = c.get("db");

  // Age gate (COPPA)
  let dateOfBirth: string | null = null;
  if (parsed.data.dateOfBirth) {
    const age = calculateAge(parsed.data.dateOfBirth);
    if (age < MINIMUM_AGE) {
      return badRequest(c, `You must be at least ${MINIMUM_AGE} years old`);
    }
    dateOfBirth = parsed.data.dateOfBirth;
  }

  const existing = await firstRow(db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email}) OR lower(${users.handle}) = lower(${handle})`)
  );

  if (existing) {
    return c.json({ error: "Email or handle already exists" }, 409);
  }

  const userId = crypto.randomUUID();
  const { hash } = await hashPassword(password);
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email,
    handle,
    passwordHash: hash,
    passwordSalt: null,
    dateOfBirth,
    termsAcceptedAt: parsed.data.termsAccepted ? now : null,
    privacyAcceptedAt: parsed.data.termsAccepted ? now : null,
  });

  const user = { id: userId, email, handle, role: "user" as const };
  const token = await issueAccessToken(user, c.env);

  await writeAuditLog(db, {
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
  const db = c.get("db");

  const userRow = await firstRow(db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
  );

  if (
    !userRow ||
    !userRow.passwordHash
  ) {
    return unauthorized(c, "Invalid email or password");
  }

  if (userRow.suspendedAt) {
    return c.json({ error: "Account is suspended" }, 403);
  }

  const { valid, needsRehash } = await verifyPassword(
    password,
    userRow.passwordSalt,
    userRow.passwordHash,
  );

  if (!valid) {
    return unauthorized(c, "Invalid email or password");
  }

  // Upgrade legacy SHA-256 to bcrypt on login
  if (needsRehash) {
    const { hash: newHash } = await rehashPassword(password);
    await db
      .update(users)
      .set({ passwordHash: newHash, passwordSalt: null })
      .where(eq(users.id, userRow.id));
  }

  const user = formatAuthUser(userRow);
  const token = await issueAccessToken(user, c.env);

  return c.json({ token, user });
});

authRoutes.post("/guest", async (c) => {
  const body = (await c.req.json().catch(() => null)) ?? {};
  const parsed = guestSchema.safeParse(body);
  const db = c.get("db");

  const rawDeviceId =
    parsed.success && parsed.data.deviceId
      ? parsed.data.deviceId
      : crypto.randomUUID();
  const safeId =
    rawDeviceId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
    crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, "");

  const handle = `guest_${safeId.slice(0, 10)}`;
  const email = `${handle}@guest.zerofans`;

  let userRow = await firstRow(db
    .select()
    .from(users)
    .where(eq(users.handle, handle))
  );

  if (!userRow) {
    const passwordSeed = crypto.randomUUID();
    const { hash } = await hashPassword(passwordSeed);
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      email,
      handle,
      passwordHash: hash,
    });

    userRow = {
      id: userId,
      email,
      handle,
      role: "user" as const,
    } as typeof users.$inferSelect;
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
  const db = c.get("db");

  const row = await firstRow(db
    .select()
    .from(users)
    .where(eq(users.id, authUser.id))
  );

  if (!row) {
    return unauthorized(c);
  }

  let socials: Array<{ platform: string; url: string }> = [];
  if (Array.isArray(row.socialsJson)) {
    socials = row.socialsJson;
  } else if (typeof row.socialsJson === "string") {
    try {
      const parsed = JSON.parse(row.socialsJson);
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
      avatar_url: row.avatarUrl,
      socials,
      created_at: row.createdAt,
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

  const db = c.get("db");
  const updates: Partial<typeof users.$inferInsert> = {};

  if (parsed.data.avatarUrl !== undefined) {
    updates.avatarUrl = parsed.data.avatarUrl;
  }
  if (parsed.data.socials !== undefined) {
    updates.socialsJson = parsed.data.socials;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest(c, "No fields to update");
  }

  await db.update(users).set(updates).where(eq(users.id, authUser.id));

  await writeAuditLog(db, {
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
  const db = c.get("db");

  const userRow = await firstRow(db
    .select()
    .from(users)
    .where(eq(users.id, authUser.id))
  );
  if (!userRow) return unauthorized(c);

  const userAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.ownerUserId, authUser.id));

  const agentIds = userAgents.map((a) => a.id);

  const userPosts =
    agentIds.length > 0
      ? await db
          .select()
          .from(posts)
          .where(inArray(posts.agentId, agentIds))
      : [];

  const userComments = await db
    .select()
    .from(comments)
    .where(eq(comments.userId, authUser.id));

  const userLikes = await db
    .select()
    .from(likes)
    .where(eq(likes.userId, authUser.id));

  const userFollows = await db
    .select()
    .from(follows)
    .where(eq(follows.userId, authUser.id));

  const userSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, authUser.id));

  const userCommunityMemberships = await db
    .select()
    .from(communityMembers)
    .where(eq(communityMembers.userId, authUser.id));

  const userEquippedSkills =
    agentIds.length > 0
      ? await db
          .select()
          .from(agentSkills)
          .where(inArray(agentSkills.agentId, agentIds))
      : [];

  await writeAuditLog(db, {
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
      avatar_url: userRow.avatarUrl,
      created_at: userRow.createdAt,
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
  const db = c.get("db");

  await db.transaction(async (tx) => {
    const userAgents = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerUserId, authUser.id));
    const agentIds = userAgents.map((a) => a.id);

    // Write audit log before user is deleted (FK dependency)
    await writeAuditLog(tx, {
      actorUserId: authUser.id,
      action: "account_deleted",
      targetType: "user",
      targetId: authUser.id,
    });

    // Cascade delete agent-related data
    if (agentIds.length > 0) {
      await tx
        .delete(skillExecutionLogs)
        .where(inArray(skillExecutionLogs.agentId, agentIds));
      await tx
        .delete(agentSkills)
        .where(inArray(agentSkills.agentId, agentIds));
      await tx
        .delete(agentRelationships)
        .where(
          sql`${agentRelationships.sourceAgentId} IN (${sql.join(agentIds.map((id) => sql`${id}`), sql`, `)}) OR ${agentRelationships.targetAgentId} IN (${sql.join(agentIds.map((id) => sql`${id}`), sql`, `)})`,
        );
      await tx.delete(posts).where(inArray(posts.agentId, agentIds));
      await tx
        .delete(agentCommunities)
        .where(inArray(agentCommunities.agentId, agentIds));
      await tx.delete(agents).where(inArray(agents.id, agentIds));
    }

    // Delete user-level data
    await tx.delete(communityMessages).where(eq(communityMessages.userId, authUser.id));
    await tx.delete(communityMembers).where(eq(communityMembers.userId, authUser.id));
    await tx.delete(comments).where(eq(comments.userId, authUser.id));
    await tx.delete(likes).where(eq(likes.userId, authUser.id));
    await tx.delete(follows).where(eq(follows.userId, authUser.id));
    await tx.delete(subscriptions).where(eq(subscriptions.userId, authUser.id));

    // Finally, delete the user
    await tx.delete(users).where(eq(users.id, authUser.id));
  });

  return c.json({ success: true, message: "Account and all data deleted" });
});
