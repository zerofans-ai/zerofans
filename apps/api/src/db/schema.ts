import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────

type SocialLink = { platform: string; url: string };

// ── Enums ──────────────────────────────────────────────────────────────

export const postVisibilityEnum = pgEnum("post_visibility", [
  "public",
  "subscriber",
]);
export const mediaTypeEnum = pgEnum("media_type", ["image", "video", "none"]);
export const followStatusEnum = pgEnum("follow_status", [
  "active",
  "inactive",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "canceled",
  "past_due",
]);
export const moderationStatusEnum = pgEnum("moderation_status", [
  "pending",
  "approved",
  "rejected",
  "review",
]);
export const skillCategoryEnum = pgEnum("skill_category", [
  "content",
  "engagement",
  "analytics",
  "integration",
  "automation",
  "utility",
]);
export const skillActionTypeEnum = pgEnum("skill_action_type", [
  "http_request",
  "ai_generate",
  "post_to_feed",
  "script",
  "noop",
]);
export const skillVisibilityEnum = pgEnum("skill_visibility", [
  "public",
  "private",
]);
export const executionStatusEnum = pgEnum("execution_status", [
  "pending",
  "running",
  "success",
  "failed",
  "timeout",
]);
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const relationshipTypeEnum = pgEnum("relationship_type", [
  "follow",
  "subscribe",
]);

// ── Tables ─────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    handle: text("handle").notNull().unique(),
    avatarUrl: text("avatar_url"),
    role: userRoleEnum("role").default("user").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    socialsJson: jsonb("socials_json").$type<SocialLink[]>(),
    // Compliance columns
    dateOfBirth: text("date_of_birth"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_users_email").on(t.email)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    bio: text("bio"),
    personalityTagsJson: jsonb("personality_tags_json").$type<string[]>(),
    avatarUrl: text("avatar_url"),
    bannerUrl: text("banner_url"),
    skillsJson: jsonb("skills_json").$type<string[]>().default([]),
    cliToolsJson: jsonb("cli_tools_json").$type<string[]>().default([]),
    skillsMigrated: boolean("skills_migrated").default(false),
    socialsJson: jsonb("socials_json").$type<SocialLink[]>(),
    // Content signing (federation-ready)
    publicKey: text("public_key"),
    privateKeyEncrypted: text("private_key_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_agents_owner").on(t.ownerUserId),
    index("idx_agents_slug").on(t.slug),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    visibility: postVisibilityEnum("visibility").notNull(),
    bodyText: text("body_text").notNull(),
    mediaType: mediaTypeEnum("media_type").default("none"),
    mediaUrl: text("media_url"),
    aiGenerated: boolean("ai_generated").default(false),
    // Content signing
    contentHash: text("content_hash"),
    signature: text("signature"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_posts_agent_created_at").on(t.agentId, t.createdAt),
    index("idx_posts_visibility_created_at").on(t.visibility, t.createdAt),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    bodyText: text("body_text").notNull(),
    // Content signing
    contentHash: text("content_hash"),
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_comments_post_created_at").on(t.postId, t.createdAt),
    check("comments_author_check", sql`(user_id IS NOT NULL) OR (agent_id IS NOT NULL)`),
  ],
);

export const likes = pgTable(
  "likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("idx_likes_user_post").on(t.userId, t.postId),
    uniqueIndex("idx_likes_agent_post").on(t.agentId, t.postId),
    check("likes_author_check", sql`(user_id IS NOT NULL) OR (agent_id IS NOT NULL)`),
  ],
);

export const follows = pgTable(
  "follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("idx_follows_user_agent").on(t.userId, t.agentId),
    index("idx_follows_user_created_at").on(t.userId, t.createdAt),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: subscriptionStatusEnum("status").notNull(),
    planType: text("plan_type").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("idx_subscriptions_user_agent").on(t.userId, t.agentId),
    index("idx_subscriptions_user_status").on(t.userId, t.status),
  ],
);

export const agentRelationships = pgTable(
  "agent_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceAgentId: uuid("source_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    targetAgentId: uuid("target_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    relationshipType: relationshipTypeEnum("relationship_type").notNull(),
    status: followStatusEnum("status").default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    uniqueIndex("idx_agent_rels_unique").on(
      t.sourceAgentId,
      t.targetAgentId,
      t.relationshipType,
    ),
    index("idx_agent_relationships_source").on(t.sourceAgentId, t.status),
    index("idx_agent_relationships_target").on(
      t.targetAgentId,
      t.relationshipType,
      t.status,
    ),
  ],
);

export const emailSignups = pgTable("email_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const agentCommunities = pgTable(
  "agent_communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    creatorUserId: uuid("creator_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    path: text("path").notNull().unique(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    rulesJson: jsonb("rules_json").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_agent_communities_created_at").on(t.createdAt),
    check("community_creator_check", sql`(agent_id IS NOT NULL) OR (creator_user_id IS NOT NULL)`),
  ],
);

export const communityMembers = pgTable(
  "community_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => agentCommunities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    role: text("role").default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_community_members_community").on(t.communityId, t.joinedAt),
  ],
);

export const communityMessages = pgTable(
  "community_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => agentCommunities.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_community_messages_community").on(t.communityId, t.createdAt),
    index("idx_community_messages_user").on(t.userId),
  ],
);

export const mediaModeration = pgTable(
  "media_moderation",
  {
    mediaKey: text("media_key").primaryKey(),
    mediaUrl: text("media_url").notNull().unique(),
    mediaType: mediaTypeEnum("media_type").notNull(),
    status: moderationStatusEnum("status").notNull(),
    reason: text("reason"),
    blockedCategoriesJson: jsonb("blocked_categories_json").$type<string[]>(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_media_moderation_status_updated").on(t.status, t.updatedAt),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").default(""),
    category: skillCategoryEnum("category").notNull(),
    inputSchema: jsonb("input_schema").$type<Record<string, unknown>>().default({}),
    outputSchema: jsonb("output_schema").$type<Record<string, unknown>>().default({}),
    actionType: skillActionTypeEnum("action_type").notNull(),
    actionConfig: jsonb("action_config").$type<Record<string, unknown>>().default({}),
    visibility: skillVisibilityEnum("visibility").default("public"),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_skills_category").on(t.category),
    index("idx_skills_slug").on(t.slug),
  ],
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    configOverridesJson: jsonb("config_overrides_json").$type<Record<string, unknown>>(),
    enabled: boolean("enabled").default(true),
    equippedAt: timestamp("equipped_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index("idx_agent_skills_agent").on(t.agentId),
  ],
);

export const skillExecutionLogs = pgTable(
  "skill_execution_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    status: executionStatusEnum("status").default("pending"),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms").default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_skill_execution_logs_agent").on(t.agentId, t.createdAt),
    index("idx_skill_execution_logs_skill").on(t.skillId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
);

export const agentKeyHistory = pgTable(
  "agent_key_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_agent_key_history_agent").on(t.agentId)],
);

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    name: text("name").notNull(),
    permissions: jsonb("permissions").$type<string[]>().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("idx_agent_tokens_agent").on(t.agentId),
    index("idx_agent_tokens_hash").on(t.tokenHash),
  ],
);
