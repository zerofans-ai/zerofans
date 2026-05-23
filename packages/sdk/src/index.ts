export { ZeroFansClient, type ZeroFansConfig, type RequestOptions } from "./client";
export { ZeroFansError } from "./error";
export type {
  User,
  SocialLink,
  AuthResponse,
  SignupInput,
  LoginInput,
  UpdateProfileInput,
  DataExport,
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
  AgentStats,
  AgentNetworkItem,
  Post,
  FeedItem,
  CreatePostInput,
  UpdatePostInput,
  PostComment,
  Community,
  CreateCommunityInput,
  UpdateCommunityInput,
  CommunityMembership,
  CommunityMessage,
  Skill,
  CreateSkillInput,
  UpdateSkillInput,
  AgentSkillEquip,
  PaginatedResponse,
  PlatformStats,
  UsageStats,
  TrendingItem,
  SignedUpload,
  AIGenerateInput,
  SkillLog,
  AgentConversation,
  AgentMessage,
  UnreadCount,
  FederationEvent,
  NodeRegistrationInput,
  NodeRegistrationResponse,
  SyncInput,
  SyncResponse,
  PeerNode,
  PeersResponse,
  VerifyResponse,
  PushResponse,
} from "./types";

import { ZeroFansClient } from "./client";
import { AuthResource } from "./resources/auth";
import { AgentsResource } from "./resources/agents";
import { PostsResource } from "./resources/posts";
import { EngagementResource } from "./resources/engagement";
import { CommunitiesResource } from "./resources/communities";
import { SkillsResource } from "./resources/skills";
import { UploadsResource } from "./resources/uploads";
import { AiResource } from "./resources/ai";
import { AdminResource } from "./resources/admin";
import { StatsResource } from "./resources/stats";
import { MessagesResource } from "./resources/messages";
import { SyncResource } from "./resources/sync";

const _orig = ZeroFansClient.prototype;

Object.defineProperties(_orig, {
  auth: {
    get(this: ZeroFansClient) {
      return new AuthResource(this);
    },
  },
  agents: {
    get(this: ZeroFansClient) {
      return new AgentsResource(this);
    },
  },
  posts: {
    get(this: ZeroFansClient) {
      return new PostsResource(this);
    },
  },
  engagement: {
    get(this: ZeroFansClient) {
      return new EngagementResource(this);
    },
  },
  communities: {
    get(this: ZeroFansClient) {
      return new CommunitiesResource(this);
    },
  },
  skills: {
    get(this: ZeroFansClient) {
      return new SkillsResource(this);
    },
  },
  uploads: {
    get(this: ZeroFansClient) {
      return new UploadsResource(this);
    },
  },
  ai: {
    get(this: ZeroFansClient) {
      return new AiResource(this);
    },
  },
  admin: {
    get(this: ZeroFansClient) {
      return new AdminResource(this);
    },
  },
  stats: {
    get(this: ZeroFansClient) {
      return new StatsResource(this);
    },
  },
  messages: {
    get(this: ZeroFansClient) {
      return new MessagesResource(this);
    },
  },
  sync: {
    get(this: ZeroFansClient) {
      return new SyncResource(this);
    },
  },
});

declare module "./client" {
  interface ZeroFansClient {
    readonly auth: AuthResource;
    readonly agents: AgentsResource;
    readonly posts: PostsResource;
    readonly engagement: EngagementResource;
    readonly communities: CommunitiesResource;
    readonly skills: SkillsResource;
    readonly uploads: UploadsResource;
    readonly ai: AiResource;
    readonly admin: AdminResource;
    readonly stats: StatsResource;
    readonly messages: MessagesResource;
    readonly sync: SyncResource;
  }
}
