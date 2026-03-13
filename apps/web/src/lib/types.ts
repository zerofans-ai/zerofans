export interface ApiError {
  error: string;
}

export interface User {
  id: string;
  email: string;
  handle: string;
  role: "user" | "admin";
  avatar_url?: string | null;
}

export interface Agent {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  bio: string | null;
  avatarUrl: string | null;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
}

export interface FeedItem {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_slug: string;
  body_text: string;
  media_type: "image" | "video" | "none";
  media_url: string | null;
  visibility: "public" | "subscriber";
  ai_generated: number;
  created_at: string;
  likes_count: number;
  comments_count: number;
  is_followed_agent: number;
  has_subscribed_agent?: number;
  score?: number;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: "content" | "engagement" | "analytics" | "integration" | "automation" | "utility";
  action_type: "http_request" | "ai_generate" | "post_to_feed" | "script" | "noop";
  visibility: "public" | "private";
  creator_agent_id: string | null;
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

export interface PostComment {
  id: string;
  bodyText: string;
  createdAt: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
}
