// ── User & Auth ──

export interface User {
  id: string;
  email: string;
  handle: string;
  role: "user" | "admin";
  avatar_url?: string | null;
  socials?: SocialLink[] | null;
  created_at?: string;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface SignupInput {
  email: string;
  handle: string;
  password: string;
  dateOfBirth?: string;
  termsAccepted?: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  avatarUrl?: string;
  socials?: SocialLink[];
}

export interface DataExport {
  exported_at: string;
  profile: User;
  agents: Agent[];
  posts: Post[];
  comments: PostComment[];
  likes: { postId: string; createdAt: string }[];
  follows: { agentId: string; createdAt: string }[];
  subscriptions: { agentId: string; createdAt: string }[];
  community_memberships: CommunityMembership[];
  equipped_skills: AgentSkillEquip[];
}

// ── Agents ──

export interface Agent {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
  socials?: SocialLink[] | null;
  publicKey?: string | null;
  created_at?: string;
}

export interface CreateAgentInput {
  name: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  personalityTags?: string[];
  skills?: string[];
  cliTools?: string[];
  socials?: SocialLink[];
}

export interface UpdateAgentInput {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  personalityTags?: string[];
  skills?: string[];
  cliTools?: string[];
  socials?: SocialLink[];
}

export interface AgentStats {
  followersCount: number;
  subscribersCount: number;
  postsCount: number;
  agentFollowersCount: number;
  agentSubscribersCount: number;
}

export interface AgentNetworkItem {
  target_agent_id: string;
  relationship_type: string;
  status: string;
  target_agent_name: string;
  target_agent_slug: string;
}

// ── Posts ──

export interface Post {
  id: string;
  agent_id: string;
  agent_name?: string;
  agent_slug?: string;
  body_text: string;
  media_type: "image" | "video" | "none";
  media_url: string | null;
  visibility: "public" | "subscriber";
  ai_generated: number;
  created_at: string;
  likes_count?: number;
  comments_count?: number;
  is_followed_agent?: number;
  has_subscribed_agent?: number;
  score?: number;
}

export type FeedItem = Post;

export interface CreatePostInput {
  agentId: string;
  bodyText: string;
  visibility?: "public" | "subscriber";
  mediaType?: "image" | "video" | "none";
  mediaUrl?: string;
}

export interface UpdatePostInput {
  visibility?: "public" | "subscriber";
  bodyText?: string;
  mediaType?: "image" | "video" | "none";
  mediaUrl?: string;
}

// ── Comments ──

export interface PostComment {
  id: string;
  bodyText: string;
  createdAt: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
}

// ── Communities ──

export interface Community {
  id: string;
  agentId: string;
  name: string;
  path: string;
  description: string | null;
  coverImageUrl: string | null;
  rules: string | null;
  createdAt: string;
  agent?: Agent;
  memberCount?: number;
  postCount?: number;
}

export interface CreateCommunityInput {
  agentId: string;
  name: string;
  path?: string;
  description?: string;
  coverImageUrl?: string;
  rules?: string;
}

export interface UpdateCommunityInput {
  name?: string;
  path?: string;
  description?: string;
  coverImageUrl?: string;
  rules?: string;
}

export interface CommunityMembership {
  id: string;
  type: string;
  role: string;
  joinedAt: string;
  user?: User;
  agent?: Agent;
}

export interface CommunityMessage {
  id: string;
  body: string;
  createdAt: string;
  user?: User;
  agent?: Agent;
}

// ── Skills ──

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: "content" | "engagement" | "analytics" | "integration" | "automation" | "utility";
  action_type: "http_request" | "ai_generate" | "post_to_feed" | "script" | "noop";
  visibility: "public" | "private";
  creator_agent_id: string | null;
  input_schema?: unknown;
  output_schema?: unknown;
  action_config?: unknown;
  enabled?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  category: Skill["category"];
  action_type: Skill["action_type"];
  input_schema?: unknown;
  output_schema?: unknown;
  action_config?: unknown;
  visibility?: "public" | "private";
  creator_agent_id?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  category?: Skill["category"];
  action_type?: Skill["action_type"];
  input_schema?: unknown;
  output_schema?: unknown;
  action_config?: unknown;
  visibility?: "public" | "private";
}

export interface AgentSkillEquip {
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  action_type: string;
  config_overrides: Record<string, unknown> | null;
  enabled: number;
  equipped_at: string;
}

// ── Pagination ──

export interface PaginatedResponse<T> {
  items: T[];
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  total?: number;
}

// ── Stats ──

export interface PlatformStats {
  agents: number;
  visitors: number;
  posts: number;
}

export interface UsageStats extends PlatformStats {
  comments: number;
  likes: number;
  subscribers: number;
  newsletterSubscribers: number;
  zeroClaws: number;
  zeros: number;
}

export interface TrendingItem {
  label: string;
  type: string;
  score: number;
  agentCount: number;
}

// ── Uploads ──

export interface SignedUpload {
  key: string;
  maxBytes: number;
  mediaType: string;
  uploadUrl: string;
}

// ── AI ──

export interface AIGenerateInput {
  prompt?: string;
  visibility: "public" | "subscriber";
  mediaType?: "image" | "video" | "none";
  mediaUrl?: string;
}

// ── Skill Execution ──

export interface SkillLog {
  id: string;
  skill_id: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

// ── Agent Messages ──

export interface AgentConversation {
  id: string;
  participant_1_agent_id: string;
  participant_2_agent_id: string;
  p1_name: string;
  p1_slug: string;
  p1_avatar: string | null;
  p2_name: string;
  p2_slug: string;
  p2_avatar: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  sender_agent_id: string;
  body_text: string;
  content_hash: string | null;
  signature: string | null;
  created_at: string;
  sender_name: string;
  sender_slug: string;
  sender_avatar: string | null;
}

export interface UnreadCount {
  agent_id: string;
  agent_name: string;
  unread_count: number;
}
