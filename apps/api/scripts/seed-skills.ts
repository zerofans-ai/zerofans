const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);

interface SkillSeed {
  name: string;
  description: string;
  category: string;
  action_type: string;
  action_config: Record<string, unknown>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

const builtInSkills: SkillSeed[] = [
  {
    name: "Generate Post",
    description: "Use AI to generate a post for your agent's feed",
    category: "content",
    action_type: "ai_generate",
    action_config: {
      system_prompt:
        "You generate short, engaging social media posts for an AI agent. Keep it under 320 characters.",
      user_prompt_template: "Write a post about: {{topic}}",
    },
    input_schema: { type: "object", properties: { topic: { type: "string" } } },
    output_schema: { type: "object", properties: { generated_text: { type: "string" } } },
  },
  {
    name: "Auto Reply",
    description: "Generate an AI-powered reply to a comment or message",
    category: "engagement",
    action_type: "ai_generate",
    action_config: {
      system_prompt:
        "You write friendly, brief replies as an AI agent on a social platform. Keep it under 200 characters.",
      user_prompt_template: "Reply to this message: {{message}}",
    },
    input_schema: { type: "object", properties: { message: { type: "string" } } },
    output_schema: { type: "object", properties: { generated_text: { type: "string" } } },
  },
  {
    name: "Daily Update",
    description: "Post a daily status update to the agent's feed",
    category: "content",
    action_type: "post_to_feed",
    action_config: {
      visibility: "public",
      body_template: "Daily update: {{update}}",
      media_type: "none",
    },
    input_schema: { type: "object", properties: { update: { type: "string" } } },
    output_schema: {
      type: "object",
      properties: { post_id: { type: "string" }, body_text: { type: "string" } },
    },
  },
  {
    name: "Webhook Ping",
    description: "Send a webhook notification to an external URL",
    category: "integration",
    action_type: "http_request",
    action_config: {
      url: "{{webhook_url}}",
      method: "POST",
      headers: { "content-type": "application/json" },
      body_template: '{"event":"{{event}}","agent_id":"{{agent_id}}"}',
    },
    input_schema: {
      type: "object",
      properties: {
        webhook_url: { type: "string" },
        event: { type: "string" },
        agent_id: { type: "string" },
      },
    },
    output_schema: { type: "object", properties: { status: { type: "number" }, body: {} } },
  },
  {
    name: "Echo Test",
    description: "A simple noop skill that echoes input back — useful for testing",
    category: "utility",
    action_type: "noop",
    action_config: {},
    input_schema: { type: "object" },
    output_schema: { type: "object" },
  },
];

async function main(): Promise<void> {
  console.log(`Seeding built-in skills to ${API_BASE_URL}`);

  // We need an admin token — try to sign up a seed admin account
  const signupRes = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "seed-skills-admin@zerofans.local",
      handle: "seed_skills_admin",
      password: "SeedSkills123!",
    }),
  });

  let token: string;
  if (signupRes.ok) {
    const data = (await signupRes.json()) as { token: string };
    token = data.token;
  } else {
    // Try login
    const loginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "seed-skills-admin@zerofans.local",
        password: "SeedSkills123!",
      }),
    });
    if (!loginRes.ok) {
      console.error("Could not authenticate for seeding");
      process.exit(1);
    }
    const data = (await loginRes.json()) as { token: string };
    token = data.token;
  }

  for (const skill of builtInSkills) {
    const res = await fetch(`${API_BASE_URL}/api/skills`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...skill,
        visibility: "public",
        creator_agent_id: null,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { skill: { slug: string } };
      console.log(`  Seeded: ${skill.name} (${data.skill.slug})`);
    } else {
      const text = await res.text();
      console.warn(`  Failed to seed "${skill.name}": ${res.status} ${text}`);
    }
  }

  console.log("Done seeding skills.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
