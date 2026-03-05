import type { EnvBindings } from "../types/env";

export interface ModerationInput {
  text?: string | null;
  mediaUrl?: string | null;
}

export interface ModerationDecision {
  allowed: boolean;
  reason?: string;
  blockedCategories?: string[];
}

interface ProviderModerationResponse {
  results?: Array<{
    flagged?: boolean;
    categories?: Record<string, boolean | undefined>;
  }>;
}

const EXPLICIT_SEXUAL_PATTERNS = [
  /\bnude\b/i,
  /\bnudity\b/i,
  /\bnaked\b/i,
  /\bnsfw\b/i,
  /\bporn(?:ography)?\b/i,
  /\bsex(?:ual)?\b/i,
  /\bblowjob\b/i,
  /\bfellatio\b/i,
  /\bcunnilingus\b/i,
  /\bcreampie\b/i,
  /\bcumshot\b/i,
  /\bdeepthroat\b/i,
  /\bgenitals?\b/i,
  /\bpenis\b/i,
  /\bvagina\b/i,
  /\bnipples?\b/i,
  /\bareola\b/i,
  /\bdick[\s_-]?pic\b/i,
  /\bboobs?\b/i,
  /\bexplicit\s+adult\b/i,
];

function contentModerationDisabled(env: EnvBindings): boolean {
  return env.CONTENT_MODERATION_DISABLED === "1";
}

function failClosed(env: EnvBindings): boolean {
  return env.CONTENT_MODERATION_FAIL_CLOSED !== "0";
}

function runRuleBasedModeration(input: ModerationInput): ModerationDecision {
  const combined = [input.text?.trim(), input.mediaUrl?.trim()].filter(Boolean).join(" ");
  if (!combined) {
    return { allowed: true };
  }

  for (const pattern of EXPLICIT_SEXUAL_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        allowed: false,
        reason:
          "Content blocked by safety policy. Sexual or nudity-related content is not allowed.",
        blockedCategories: ["sexual"],
      };
    }
  }

  return { allowed: true };
}

async function runProviderModeration(
  env: EnvBindings,
  input: ModerationInput,
): Promise<ModerationDecision> {
  if (!env.AI_API_KEY) {
    return { allowed: true };
  }

  const chunks = [input.text?.trim(), input.mediaUrl?.trim()].filter(
    (value): value is string => Boolean(value),
  );
  if (chunks.length === 0) {
    return { allowed: true };
  }

  const baseUrl = env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = env.AI_MODERATION_MODEL ?? "omni-moderation-latest";

  try {
    const response = await fetch(`${baseUrl}/moderations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: chunks,
      }),
    });

    if (!response.ok) {
      throw new Error(`Moderation API returned ${response.status}`);
    }

    const payload = (await response.json()) as ProviderModerationResponse;
    const results = payload.results ?? [];
    for (const result of results) {
      if (!result.flagged) {
        continue;
      }

      const blockedCategories = Object.entries(result.categories ?? {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([name]) => name);

      return {
        allowed: false,
        reason:
          "Content blocked by safety policy. Sexual, explicit, or otherwise unsafe content is not allowed.",
        blockedCategories,
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error("Content moderation provider failed", error);
    if (failClosed(env)) {
      return {
        allowed: false,
        reason: "Content moderation unavailable. Please retry in a moment.",
      };
    }
    return { allowed: true };
  }
}

export async function moderateContent(
  env: EnvBindings,
  input: ModerationInput,
): Promise<ModerationDecision> {
  if (contentModerationDisabled(env)) {
    return { allowed: true };
  }

  const ruleDecision = runRuleBasedModeration(input);
  if (!ruleDecision.allowed) {
    return ruleDecision;
  }

  const providerDecision = await runProviderModeration(env, input);
  return providerDecision;
}
