import { eq, sql } from "drizzle-orm";
import type { EnvBindings } from "../types/env";
import type {
  SkillDefinition,
  ExecuteSkillResult,
  HttpRequestConfig,
  AiGenerateConfig,
  PostToFeedConfig,
  ScriptConfig,
  ScriptStep,
} from "../types/skills";
import { callOpenAIStyleAPI } from "./ai";
import type { Database } from "../db"
import { firstRow } from "../db";
import { skillExecutionLogs, posts } from "../db/schema";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_INPUT_BYTES = 10_240;
const MAX_OUTPUT_BYTES = 51_200;
const RATE_LIMIT_PER_HOUR = 60;

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : "";
  });
}

function truncateOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized.length > MAX_OUTPUT_BYTES) {
    return { truncated: true, preview: serialized.slice(0, MAX_OUTPUT_BYTES) };
  }
  return output;
}

function getAllowedDomains(env: EnvBindings): string[] {
  if (!env.SKILL_ALLOWED_DOMAINS) return [];
  return env.SKILL_ALLOWED_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean);
}

function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return allowedDomains.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`),
    );
  } catch {
    return false;
  }
}

async function executeHttpRequest(
  env: EnvBindings,
  config: HttpRequestConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const url = interpolate(config.url, input);

  const allowedDomains = getAllowedDomains(env);
  if (allowedDomains.length > 0 && !isDomainAllowed(url, allowedDomains)) {
    throw new Error(`Domain not allowed: ${url}`);
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (allowedDomains.length > 0 && !url.startsWith("https://")) {
    throw new Error("Only HTTPS URLs are allowed");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.headers,
  };

  const fetchOptions: RequestInit = {
    method: config.method,
    headers,
  };

  if (config.body_template && config.method !== "GET") {
    fetchOptions.body = interpolate(config.body_template, input);
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: response.status,
    body,
  };
}

async function executeAiGenerate(
  env: EnvBindings,
  config: AiGenerateConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const userPrompt = interpolate(config.user_prompt_template, input);

  const result = await callOpenAIStyleAPI(env, {
    agent: {
      name: (input.agent_name as string) || "Agent",
      bio: (input.agent_bio as string) || null,
      personalityTags: [],
      skills: [],
      cliTools: [],
    },
    prompt: userPrompt,
  });

  return {
    generated_text: result,
  };
}

async function executePostToFeed(
  db: Database,
  agentId: string,
  config: PostToFeedConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const bodyText = interpolate(config.body_template, input);
  const postId = crypto.randomUUID();

  await db.insert(posts).values({
    id: postId,
    agentId,
    visibility: config.visibility as "public" | "subscriber",
    bodyText: bodyText.trim(),
    mediaType: (config.media_type as "image" | "video" | "none") ?? "none",
    aiGenerated: true,
  });

  return {
    post_id: postId,
    body_text: bodyText.trim(),
  };
}

async function executeNoop(input: Record<string, unknown>): Promise<unknown> {
  return { echo: input };
}

function evaluateCondition(
  condition: { field: string; operator: string; value: string | number | boolean },
  context: Record<string, unknown>,
): boolean {
  const actual = context[condition.field];
  const expected = condition.value;

  switch (condition.operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return typeof actual === "string" && actual.includes(String(expected));
    case "gt":
      return typeof actual === "number" && actual > Number(expected);
    case "lt":
      return typeof actual === "number" && actual < Number(expected);
    default:
      return true;
  }
}

async function executeSingleStep(
  db: Database,
  env: EnvBindings,
  agentId: string,
  step: ScriptStep,
  context: Record<string, unknown>,
): Promise<unknown> {
  const stepInput: Record<string, unknown> = { ...context };

  if (step.input_map) {
    for (const [key, sourceKey] of Object.entries(step.input_map)) {
      stepInput[key] = context[sourceKey];
    }
  }

  switch (step.action_type) {
    case "http_request":
      return executeHttpRequest(env, step.action_config as HttpRequestConfig, stepInput);
    case "ai_generate":
      return executeAiGenerate(env, step.action_config as AiGenerateConfig, stepInput);
    case "post_to_feed":
      return executePostToFeed(db, agentId, step.action_config as PostToFeedConfig, stepInput);
    case "noop":
      return executeNoop(stepInput);
    default:
      throw new Error(`Unknown step action_type: ${step.action_type}`);
  }
}

async function executeScript(
  db: Database,
  env: EnvBindings,
  agentId: string,
  config: ScriptConfig,
  input: Record<string, unknown>,
): Promise<unknown> {
  const context: Record<string, unknown> = { ...input };
  const results: Record<string, unknown> = {};

  const groups: Map<string | null, ScriptStep[]> = new Map();
  for (const step of config.steps) {
    const group = step.parallel_group ?? null;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(step);
  }

  const orderedGroups: Array<ScriptStep[]> = [];
  const seenParallel = new Set<string>();

  for (const step of config.steps) {
    if (step.parallel_group) {
      if (!seenParallel.has(step.parallel_group)) {
        seenParallel.add(step.parallel_group);
        orderedGroups.push(groups.get(step.parallel_group)!);
      }
    } else {
      orderedGroups.push([step]);
    }
  }

  for (const group of orderedGroups) {
    if (group.length === 1) {
      const step = group[0]!;
      if (step.condition && !evaluateCondition(step.condition, context)) {
        results[step.id] = { skipped: true };
        continue;
      }
      const result = await executeSingleStep(db, env, agentId, step, context);
      results[step.id] = result;
      context[`step_${step.id}`] = result;
    } else {
      const parallelResults = await Promise.all(
        group.map(async (step) => {
          if (step.condition && !evaluateCondition(step.condition, context)) {
            return { id: step.id, result: { skipped: true } };
          }
          const result = await executeSingleStep(db, env, agentId, step, context);
          return { id: step.id, result };
        }),
      );
      for (const { id, result } of parallelResults) {
        results[id] = result;
        context[`step_${id}`] = result;
      }
    }
  }

  return { steps: results };
}

export async function checkRateLimit(
  db: Database,
  agentId: string,
): Promise<boolean> {
  const row = await firstRow(db
    .select({ cnt: sql<number>`count(*)` })
    .from(skillExecutionLogs)
    .where(
      sql`${skillExecutionLogs.agentId} = ${agentId} AND ${skillExecutionLogs.createdAt} > now() - interval '1 hour'`,
    )
  );

  return (row?.cnt ?? 0) >= RATE_LIMIT_PER_HOUR;
}

export async function executeSkill(
  env: EnvBindings,
  agentId: string,
  skill: SkillDefinition,
  input: Record<string, unknown>,
): Promise<ExecuteSkillResult> {
  const db = (env as unknown as { DB: Database }).DB;
  // When called from agents.ts route, DB is set via middleware on context.
  // But this function receives env directly, so we need a different approach.
  // The caller should pass the db instance. For now, we access it from the
  // agents route via the c.get("db") pattern and pass it through.

  const inputStr = JSON.stringify(input);
  if (inputStr.length > MAX_INPUT_BYTES) {
    return {
      status: "failed",
      output: null,
      duration_ms: 0,
      error: "Input exceeds maximum size of 10KB",
    };
  }

  const logId = crypto.randomUUID();
  const startTime = Date.now();

  // This function is called from the agents route which now uses c.get("db")
  // We need to pass db through. The agents route will pass env.DB which is
  // the Drizzle instance set by middleware.
  const database = env.DB;

  await database.insert(skillExecutionLogs).values({
    id: logId,
    agentId,
    skillId: skill.id,
    status: "running",
    inputJson: input,
  });

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Skill execution timeout")), DEFAULT_TIMEOUT_MS);
    });

    let executionPromise: Promise<unknown>;

    switch (skill.action_type) {
      case "http_request":
        executionPromise = executeHttpRequest(env, skill.action_config as HttpRequestConfig, input);
        break;
      case "ai_generate":
        executionPromise = executeAiGenerate(env, skill.action_config as AiGenerateConfig, input);
        break;
      case "post_to_feed":
        executionPromise = executePostToFeed(database, agentId, skill.action_config as PostToFeedConfig, input);
        break;
      case "script":
        executionPromise = executeScript(database, env, agentId, skill.action_config as ScriptConfig, input);
        break;
      case "noop":
        executionPromise = executeNoop(input);
        break;
      default:
        throw new Error(`Unknown action_type: ${skill.action_type}`);
    }

    const output = await Promise.race([executionPromise, timeoutPromise]);
    const durationMs = Date.now() - startTime;
    const truncatedOutput = truncateOutput(output);

    await database
      .update(skillExecutionLogs)
      .set({
        status: "success",
        outputJson: truncatedOutput,
        durationMs,
      })
      .where(eq(skillExecutionLogs.id, logId));

    return {
      status: "success",
      output: truncatedOutput,
      duration_ms: durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && err.message.includes("timeout");
    const status = isTimeout ? "timeout" : "failed";
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await database
      .update(skillExecutionLogs)
      .set({
        status,
        errorMessage,
        durationMs,
      })
      .where(eq(skillExecutionLogs.id, logId));

    return {
      status,
      output: null,
      duration_ms: durationMs,
      error: errorMessage,
    };
  }
}
