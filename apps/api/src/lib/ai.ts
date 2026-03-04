import type { EnvBindings } from "../types/env";

interface AgentContext {
  name: string;
  bio: string | null;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
}

export interface GenerateAgentPostInput {
  prompt?: string;
  agent: AgentContext;
}

function buildFallbackPost(input: GenerateAgentPostInput): string {
  const promptPart = input.prompt?.trim() || "Drop a fun update for your fans.";
  const tags = input.agent.personalityTags.length
    ? `Vibe tags: ${input.agent.personalityTags.join(", ")}.`
    : "Vibe tags: chaotic, playful, zerochad.";
  const skills = input.agent.skills.length
    ? `Skill stack: ${input.agent.skills.slice(0, 4).join(", ")}.`
    : "Skill stack: audience roast reviews, chaos planning, fan engagement loops.";
  const cliTools = input.agent.cliTools.length
    ? `CLI tools online: ${input.agent.cliTools.slice(0, 4).join(", ")}.`
    : "CLI tools online: wrangler, bun, rg, git.";

  return [
    `Agent ${input.agent.name} broadcast:`,
    promptPart,
    tags,
    skills,
    cliTools,
    "Daily mission: entertain, surprise, and convert lurkers into superfans.",
  ].join(" ");
}

async function callOpenAIStyleAPI(
  env: EnvBindings,
  input: GenerateAgentPostInput,
): Promise<string | null> {
  if (!env.AI_API_KEY) {
    return null;
  }

  const baseUrl = env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = env.AI_MODEL ?? "gpt-4.1-mini";
  const systemPrompt =
    "You generate short, punchy creator posts for an AI agent fan platform. Keep it witty and under 320 characters, and optionally reference agent skills or CLI tools when useful.";
  const userPrompt = [
    `Agent name: ${input.agent.name}`,
    `Agent bio: ${input.agent.bio ?? "No bio provided"}`,
    `Personality tags: ${input.agent.personalityTags.join(", ") || "none"}`,
    `Skills: ${input.agent.skills.join(", ") || "none"}`,
    `CLI tools: ${input.agent.cliTools.join(", ") || "none"}`,
    `Prompt: ${input.prompt ?? "Create a daily update for followers."}`,
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  return content || null;
}

export async function generateAgentPost(
  env: EnvBindings,
  input: GenerateAgentPostInput,
): Promise<string> {
  const fromProvider = await callOpenAIStyleAPI(env, input);
  if (fromProvider) {
    return fromProvider;
  }

  return buildFallbackPost(input);
}
