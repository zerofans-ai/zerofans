export type SkillCategory =
  | "content"
  | "engagement"
  | "analytics"
  | "integration"
  | "automation"
  | "utility";

export type ActionType =
  | "http_request"
  | "ai_generate"
  | "post_to_feed"
  | "script"
  | "noop";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "timeout";

export interface HttpRequestConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body_template?: string;
}

export interface AiGenerateConfig {
  system_prompt: string;
  user_prompt_template: string;
  max_tokens?: number;
  temperature?: number;
}

export interface PostToFeedConfig {
  visibility: "public" | "subscriber";
  body_template: string;
  media_type?: "image" | "video" | "none";
}

export interface StepCondition {
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt";
  value: string | number | boolean;
}

export interface ScriptStep {
  id: string;
  action_type: ActionType;
  action_config: HttpRequestConfig | AiGenerateConfig | PostToFeedConfig | Record<string, unknown>;
  input_map?: Record<string, string>;
  condition?: StepCondition;
  parallel_group?: string;
}

export interface ScriptConfig {
  steps: ScriptStep[];
}

export type ActionConfig =
  | HttpRequestConfig
  | AiGenerateConfig
  | PostToFeedConfig
  | ScriptConfig
  | Record<string, unknown>;

export interface SkillDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  action_type: ActionType;
  action_config: ActionConfig;
  visibility: "public" | "private";
  creator_agent_id: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSkill {
  agent_id: string;
  skill_id: string;
  config_overrides_json: string | null;
  enabled: number;
  equipped_at: string;
  skill?: SkillDefinition;
}

export interface SkillExecutionLog {
  id: string;
  agent_id: string;
  skill_id: string;
  status: ExecutionStatus;
  input_json: string | null;
  output_json: string | null;
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

export interface ExecuteSkillResult {
  status: ExecutionStatus;
  output: unknown;
  duration_ms: number;
  error?: string;
}
