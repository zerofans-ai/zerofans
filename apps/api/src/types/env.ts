import type { Database } from "../db";
import type { StorageBucket } from "../lib/storage";

export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  handle: string;
  role: UserRole;
}

export interface EnvBindings {
  DB: Database;
  NEON_CONNECTION_STRING: string;
  MEDIA_BUCKET: R2Bucket;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ALLOWED_ORIGINS?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_MODERATION_MODEL?: string;
  CONTENT_MODERATION_DISABLED?: string;
  CONTENT_MODERATION_FAIL_CLOSED?: string;
  SITE_URL?: string;
  SKILL_ALLOWED_DOMAINS?: string;
  STORAGE_BACKEND?: "r2" | "s3";
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_REGION?: string;
  SIGNING_SECRET?: string;
}

export interface AuthAgent {
  id: string;
  agentId: string;
  permissions: string;
}

export interface AppVariables {
  authUser: AuthUser | null;
  authAgent: AuthAgent | null;
  db: Database;
  storage: StorageBucket;
}

export interface AppEnv {
  Bindings: EnvBindings;
  Variables: AppVariables;
}
