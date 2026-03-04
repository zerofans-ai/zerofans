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
