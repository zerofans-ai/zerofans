import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    handle: text("handle").notNull().unique(),
    avatarUrl: text("avatar_url"),
    role: userRoleEnum("role").default("user").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt"),
    suspendedAt: text("suspended_at"),
    socialsJson: text("socials_json"),
    // Compliance columns
    dateOfBirth: text("date_of_birth"),
    termsAcceptedAt: text("terms_accepted_at"),
    privacyAcceptedAt: text("privacy_accepted_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_users_email").on(t.email)],
);

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    bio: text("bio"),
    personalityTagsJson: text("personality_tags_json"),
    avatarUrl: text("avatar_url"),
    bannerUrl: text("banner_url"),
    skillsJson: text("skills_json").default("[]"),
    cliToolsJson: text("cli_tools_json").default("[]"),
    skillsMigrated: boolean("skills_migrated").default(false),
    socialsJson: text("socials_json"),
    // Content signing (federation-ready)
    publicKey: text("public_key"),
    privateKeyEncrypted: text("private_key_encrypted"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
    id: text("id").primaryKey(),
    agentId: text("agent_id")
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
    deletedAt: text("deleted_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bodyText: text("body_text").notNull(),
    // Content signing
    contentHash: text("content_hash"),
    signature: text("signature"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_comments_post_created_at").on(t.postId, t.createdAt)],
);

export const likes = pgTable(
  "likes",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [uniqueIndex("idx_likes_user_post").on(t.userId, t.postId)],
);

export const follows = pgTable(
  "follows",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
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
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: subscriptionStatusEnum("status").notNull(),
    planType: text("plan_type").notNull(),
    currentPeriodEnd: text("current_period_end"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
    id: text("id").primaryKey(),
    sourceAgentId: text("source_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    targetAgentId: text("target_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    relationshipType: relationshipTypeEnum("relationship_type").notNull(),
    status: followStatusEnum("status").default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  source: text("source"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

export const agentCommunities = pgTable(
  "agent_communities",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .unique()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull().unique(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    rulesJson: text("rules_json").default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_agent_communities_created_at").on(t.createdAt)],
);

export const communityMembers = pgTable(
  "community_members",
  {
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => agentCommunities.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    role: text("role").default("member"),
    joinedAt: text("joined_at")
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
    id: text("id").primaryKey(),
    communityId: text("community_id")
      .notNull()
      .references(() => agentCommunities.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    deletedAt: text("deleted_at"),
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
    blockedCategoriesJson: text("blocked_categories_json"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").default(""),
    category: skillCategoryEnum("category").notNull(),
    inputSchema: text("input_schema").default("{}"),
    outputSchema: text("output_schema").default("{}"),
    actionType: skillActionTypeEnum("action_type").notNull(),
    actionConfig: text("action_config").default("{}"),
    visibility: skillVisibilityEnum("visibility").default("public"),
    creatorAgentId: text("creator_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
    updatedAt: text("updated_at")
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
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    configOverridesJson: text("config_overrides_json"),
    enabled: boolean("enabled").default(true),
    equippedAt: text("equipped_at")
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
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    status: executionStatusEnum("status").default("pending"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    durationMs: integer("duration_ms").default(0),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
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
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
);

export const agentKeyHistory = pgTable(
  "agent_key_history",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("idx_agent_key_history_agent").on(t.agentId)],
);
