const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const RUN_ID = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto
  .randomUUID()
  .slice(0, 6)}`;
const PASSWORD = "ContractPass123!";

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
  expectedStatus?: number;
}

interface SeedUser {
  token: string;
  id: string;
  email: string;
  handle: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const url = `${API_BASE_URL}${path}`;
  const headers = new Headers();
  const expectedStatus = options.expectedStatus ?? 200;

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    throw new Error(`Unexpected ${response.status} for ${method} ${url}: ${text}`);
  }
  return payload as T;
}

async function waitForApi(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await Bun.sleep(500);
  }
  throw new Error(`API is not reachable at ${API_BASE_URL}/health`);
}

async function signup(alias: string): Promise<SeedUser> {
  const unique = RUN_ID.replace("-", "");
  const email = `skill.${alias}.${unique}@zerofans.local`;
  const handle = `${alias}_skill_${unique.slice(-8)}`.slice(0, 30);

  const created = await apiRequest<{
    token: string;
    user: { id: string; email: string; handle: string };
  }>("/api/auth/signup", {
    method: "POST",
    body: { email, handle, password: PASSWORD },
  });

  return {
    token: created.token,
    id: created.user.id,
    email: created.user.email,
    handle: created.user.handle,
  };
}

let passed = 0;
let failed = 0;

function ok(message: string): void {
  passed += 1;
  console.log(`  PASS: ${message}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    ok(name);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  console.log(`Running skills contract tests against ${API_BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);
  await waitForApi();

  const owner = await signup("skillowner");
  const viewer = await signup("skillviewer");

  // Create an agent for the owner
  const agentRes = await apiRequest<{
    agent: { id: string; slug: string; name: string };
  }>("/api/agents", {
    method: "POST",
    token: owner.token,
    body: {
      name: `SkillBot ${RUN_ID.slice(-4)}`,
      bio: "Skill system contract test agent",
      skills: ["legacy-skill-one", "legacy-skill-two"],
    },
  });
  const agentId = agentRes.agent.id;
  const agentSlug = agentRes.agent.slug;

  // Create a second agent for the viewer (non-owner tests)
  const viewerAgentRes = await apiRequest<{
    agent: { id: string; slug: string };
  }>("/api/agents", {
    method: "POST",
    token: viewer.token,
    body: { name: `ViewerBot ${RUN_ID.slice(-4)}` },
  });
  const viewerAgentId = viewerAgentRes.agent.id;

  // =====================
  // 1. Registry CRUD
  // =====================
  console.log("\n--- Registry CRUD ---");

  let fullSkillId = "";
  let fullSkillSlug = "";

  await test("Create full skill definition", async () => {
    const res = await apiRequest<{ skill: { id: string; slug: string; name: string; category: string; action_type: string } }>(
      "/api/skills",
      {
        method: "POST",
        token: owner.token,
        body: {
          name: `Test Noop ${RUN_ID.slice(-4)}`,
          description: "A noop skill for testing",
          category: "utility",
          action_type: "noop",
          action_config: {},
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          visibility: "public",
          creator_agent_id: agentId,
        },
      },
    );
    assert(res.skill.id, "Skill should have an id");
    assert(res.skill.slug, "Skill should have a slug");
    assert(res.skill.category === "utility", `Expected category utility, got ${res.skill.category}`);
    assert(res.skill.action_type === "noop", `Expected action_type noop, got ${res.skill.action_type}`);
    fullSkillId = res.skill.id;
    fullSkillSlug = res.skill.slug;
  });

  let minimalSkillId = "";

  await test("Create minimal skill definition", async () => {
    const res = await apiRequest<{ skill: { id: string; slug: string } }>(
      "/api/skills",
      {
        method: "POST",
        token: owner.token,
        body: {
          name: `Minimal ${RUN_ID.slice(-4)}`,
          category: "content",
          action_type: "noop",
          creator_agent_id: agentId,
        },
      },
    );
    assert(res.skill.id, "Minimal skill should have an id");
    minimalSkillId = res.skill.id;
  });

  await test("Get skill by slug", async () => {
    const res = await apiRequest<{ skill: { id: string; slug: string } }>(
      `/api/skills/${fullSkillSlug}`,
    );
    assert(res.skill.id === fullSkillId, "Should find skill by slug");
  });

  await test("Discover skills with filter", async () => {
    const res = await apiRequest<{ items: Array<{ id: string; category: string }> }>(
      `/api/skills/discover?q=${encodeURIComponent(RUN_ID.slice(-4))}&category=utility`,
    );
    const found = res.items.find((s) => s.id === fullSkillId);
    assert(found, "Should discover the utility skill");
  });

  await test("Patch skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/skills/${fullSkillId}`, {
      method: "PATCH",
      token: owner.token,
      body: { description: "Updated description" },
    });
    const res = await apiRequest<{ skill: { description: string } }>(
      `/api/skills/${fullSkillId}`,
    );
    assert(res.skill.description === "Updated description", "Description should be updated");
  });

  await test("Reject invalid category", async () => {
    await apiRequest<{ error: string }>("/api/skills", {
      method: "POST",
      token: owner.token,
      expectedStatus: 400,
      body: {
        name: "Invalid Category",
        category: "invalid_category",
        action_type: "noop",
      },
    });
  });

  await test("Reject unauthenticated create", async () => {
    await apiRequest<{ error: string }>("/api/skills", {
      method: "POST",
      expectedStatus: 401,
      body: {
        name: "No Auth",
        category: "utility",
        action_type: "noop",
      },
    });
  });

  // Create a post_to_feed skill for execution tests
  let postToFeedSkillId = "";
  await test("Create post_to_feed skill", async () => {
    const res = await apiRequest<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      token: owner.token,
      body: {
        name: `PostSkill ${RUN_ID.slice(-4)}`,
        category: "content",
        action_type: "post_to_feed",
        action_config: {
          visibility: "public",
          body_template: "Skill post: {{message}}",
          media_type: "none",
        },
        creator_agent_id: agentId,
      },
    });
    postToFeedSkillId = res.skill.id;
    assert(postToFeedSkillId, "post_to_feed skill should have id");
  });

  // Create an ai_generate skill
  let aiSkillId = "";
  await test("Create ai_generate skill", async () => {
    const res = await apiRequest<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      token: owner.token,
      body: {
        name: `AiSkill ${RUN_ID.slice(-4)}`,
        category: "content",
        action_type: "ai_generate",
        action_config: {
          system_prompt: "You are a helpful assistant.",
          user_prompt_template: "Say hello to {{name}}",
        },
        creator_agent_id: agentId,
      },
    });
    aiSkillId = res.skill.id;
    assert(aiSkillId, "ai_generate skill should have id");
  });

  // Create a script skill with 2 steps
  let scriptSkillId = "";
  await test("Create script skill with 2 steps", async () => {
    const res = await apiRequest<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      token: owner.token,
      body: {
        name: `ScriptSkill ${RUN_ID.slice(-4)}`,
        category: "automation",
        action_type: "script",
        action_config: {
          steps: [
            {
              id: "step1",
              action_type: "noop",
              action_config: {},
            },
            {
              id: "step2",
              action_type: "noop",
              action_config: {},
              input_map: { prev: "step_step1" },
            },
          ],
        },
        creator_agent_id: agentId,
      },
    });
    scriptSkillId = res.skill.id;
    assert(scriptSkillId, "script skill should have id");
  });

  // Create a skill with conditional step
  let conditionalSkillId = "";
  await test("Create script skill with conditional step", async () => {
    const res = await apiRequest<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      token: owner.token,
      body: {
        name: `ConditionalSkill ${RUN_ID.slice(-4)}`,
        category: "automation",
        action_type: "script",
        action_config: {
          steps: [
            {
              id: "check",
              action_type: "noop",
              action_config: {},
            },
            {
              id: "conditional",
              action_type: "noop",
              action_config: {},
              condition: { field: "skip_me", operator: "eq", value: true },
            },
          ],
        },
        creator_agent_id: agentId,
      },
    });
    conditionalSkillId = res.skill.id;
    assert(conditionalSkillId, "conditional skill should have id");
  });

  // Create a script skill with parallel steps
  let parallelSkillId = "";
  await test("Create script skill with parallel steps", async () => {
    const res = await apiRequest<{ skill: { id: string } }>("/api/skills", {
      method: "POST",
      token: owner.token,
      body: {
        name: `ParallelSkill ${RUN_ID.slice(-4)}`,
        category: "automation",
        action_type: "script",
        action_config: {
          steps: [
            {
              id: "p1",
              action_type: "noop",
              action_config: {},
              parallel_group: "batch",
            },
            {
              id: "p2",
              action_type: "noop",
              action_config: {},
              parallel_group: "batch",
            },
          ],
        },
        creator_agent_id: agentId,
      },
    });
    parallelSkillId = res.skill.id;
    assert(parallelSkillId, "parallel skill should have id");
  });

  // =====================
  // 2. Agent Equipment
  // =====================
  console.log("\n--- Agent Equipment ---");

  await test("Equip skill to agent", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: fullSkillId },
    });
  });

  await test("Equip post_to_feed skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: postToFeedSkillId },
    });
  });

  await test("Equip ai_generate skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: aiSkillId },
    });
  });

  await test("Equip script skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: scriptSkillId },
    });
  });

  await test("Equip conditional skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: conditionalSkillId },
    });
  });

  await test("Equip parallel skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: parallelSkillId },
    });
  });

  await test("List equipped skills", async () => {
    const res = await apiRequest<{ items: Array<{ skill_id: string }> }>(
      `/api/agents/${agentId}/skills`,
    );
    assert(res.items.length >= 1, "Should have at least 1 equipped skill");
    const found = res.items.find((s) => s.skill_id === fullSkillId);
    assert(found, "Should find the equipped skill");
  });

  await test("Duplicate equip is idempotent", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: fullSkillId },
    });
    const res = await apiRequest<{ items: Array<{ skill_id: string }> }>(
      `/api/agents/${agentId}/skills`,
    );
    const matches = res.items.filter((s) => s.skill_id === fullSkillId);
    assert(matches.length === 1, "Should not duplicate equipped skill");
  });

  await test("Config overrides on equip", async () => {
    await apiRequest<{ success: boolean }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      body: { skill_id: fullSkillId, config_overrides: { custom_key: "custom_value" } },
    });
    const res = await apiRequest<{ items: Array<{ skill_id: string; config_overrides: Record<string, unknown> | null }> }>(
      `/api/agents/${agentId}/skills`,
    );
    const found = res.items.find((s) => s.skill_id === fullSkillId);
    assert(found?.config_overrides?.custom_key === "custom_value", "Config overrides should persist");
  });

  await test("Non-owner cannot equip skill", async () => {
    await apiRequest<{ error: string }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: viewer.token,
      expectedStatus: 403,
      body: { skill_id: fullSkillId },
    });
  });

  await test("Equip nonexistent skill returns 404", async () => {
    await apiRequest<{ error: string }>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      token: owner.token,
      expectedStatus: 404,
      body: { skill_id: "00000000-0000-0000-0000-000000000000" },
    });
  });

  // =====================
  // 3. Execution
  // =====================
  console.log("\n--- Execution ---");

  await test("Execute noop skill echoes input", async () => {
    const res = await apiRequest<{
      result: { status: string; output: { echo: Record<string, unknown> } };
    }>(`/api/agents/${agentId}/skills/${fullSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { hello: "world" } },
    });
    assert(res.result.status === "success", `Expected success, got ${res.result.status}`);
    assert(
      (res.result.output as { echo: { hello: string } }).echo.hello === "world",
      "Noop should echo input",
    );
  });

  await test("Execute ai_generate skill produces output", async () => {
    const res = await apiRequest<{
      result: { status: string; output: unknown };
    }>(`/api/agents/${agentId}/skills/${aiSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { name: "ZeroFans", agent_name: agentRes.agent.name } },
    });
    assert(res.result.status === "success", `Expected success, got ${res.result.status}`);
    assert(res.result.output !== null, "AI generate should produce output");
  });

  await test("Execute post_to_feed skill creates post", async () => {
    const res = await apiRequest<{
      result: { status: string; output: { post_id: string; body_text: string } };
    }>(`/api/agents/${agentId}/skills/${postToFeedSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { message: `Skill post ${RUN_ID}` } },
    });
    assert(res.result.status === "success", `Expected success, got ${res.result.status}`);
    assert(res.result.output.post_id, "Should return post_id");
    assert(
      res.result.output.body_text.includes(RUN_ID),
      "Post body should contain the RUN_ID",
    );
  });

  await test("Execute script skill with piped steps", async () => {
    const res = await apiRequest<{
      result: { status: string; output: { steps: Record<string, unknown> } };
    }>(`/api/agents/${agentId}/skills/${scriptSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { data: "test" } },
    });
    assert(res.result.status === "success", `Expected success, got ${res.result.status}`);
    assert(res.result.output.steps.step1, "Step1 should have output");
    assert(res.result.output.steps.step2, "Step2 should have output");
  });

  await test("Non-owner cannot execute skill", async () => {
    await apiRequest<{ error: string }>(
      `/api/agents/${agentId}/skills/${fullSkillId}/execute`,
      {
        method: "POST",
        token: viewer.token,
        expectedStatus: 403,
        body: { input: {} },
      },
    );
  });

  await test("Unequipped skill returns 400", async () => {
    await apiRequest<{ error: string }>(
      `/api/agents/${viewerAgentId}/skills/${fullSkillId}/execute`,
      {
        method: "POST",
        token: viewer.token,
        expectedStatus: 400,
        body: { input: {} },
      },
    );
  });

  await test("Execution logs are retrievable", async () => {
    const res = await apiRequest<{
      items: Array<{ skill_id: string; status: string }>;
    }>(`/api/agents/${agentId}/skills/logs`, {
      token: owner.token,
    });
    assert(res.items.length >= 1, "Should have at least 1 execution log");
    const noopLog = res.items.find((l) => l.skill_id === fullSkillId);
    assert(noopLog, "Should find log for noop skill");
    assert(noopLog.status === "success", "Log status should be success");
  });

  // =====================
  // 4. Backward Compatibility
  // =====================
  console.log("\n--- Backward Compatibility ---");

  await test("Legacy string arrays still present on profile", async () => {
    const res = await apiRequest<{
      agent: { skills: string[]; cliTools: string[]; equippedSkills: unknown[] };
    }>(`/api/agents/${agentSlug}`);
    assert(Array.isArray(res.agent.skills), "skills should be an array");
    assert(
      res.agent.skills.includes("legacy-skill-one"),
      "Legacy skills should still be present",
    );
  });

  await test("Profile includes equippedSkills", async () => {
    const res = await apiRequest<{
      agent: { equippedSkills: Array<{ id: string }> };
    }>(`/api/agents/${agentSlug}`);
    assert(Array.isArray(res.agent.equippedSkills), "equippedSkills should be an array");
    assert(res.agent.equippedSkills.length >= 1, "Should have equipped skills");
  });

  await test("Discover returns legacy skills", async () => {
    const res = await apiRequest<{
      items: Array<{ id: string; skills: string[] }>;
    }>(`/api/agents/discover?q=${encodeURIComponent(RUN_ID.slice(-4))}&limit=25`);
    const found = res.items.find((a) => a.id === agentId);
    assert(found, "Should discover agent");
    assert(Array.isArray(found.skills), "Discover should include legacy skills array");
  });

  // =====================
  // 5. Script Edge Cases
  // =====================
  console.log("\n--- Script Edge Cases ---");

  await test("Conditional step is skipped when condition not met", async () => {
    const res = await apiRequest<{
      result: { status: string; output: { steps: Record<string, { skipped?: boolean }> } };
    }>(`/api/agents/${agentId}/skills/${conditionalSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { skip_me: false } },
    });
    assert(res.result.status === "success", "Should succeed");
    assert(
      res.result.output.steps.conditional?.skipped === true,
      "Conditional step should be skipped when condition not met",
    );
  });

  await test("Parallel steps both execute", async () => {
    const res = await apiRequest<{
      result: { status: string; output: { steps: Record<string, unknown> } };
    }>(`/api/agents/${agentId}/skills/${parallelSkillId}/execute`, {
      method: "POST",
      token: owner.token,
      body: { input: { data: "parallel_test" } },
    });
    assert(res.result.status === "success", "Should succeed");
    assert(res.result.output.steps.p1, "Parallel step p1 should have output");
    assert(res.result.output.steps.p2, "Parallel step p2 should have output");
  });

  // =====================
  // 6. Cleanup / Delete
  // =====================
  console.log("\n--- Cleanup ---");

  await test("Unequip skill", async () => {
    await apiRequest<{ success: boolean }>(
      `/api/agents/${agentId}/skills/${minimalSkillId}`,
      {
        method: "DELETE",
        token: owner.token,
      },
    );
  });

  await test("Delete (disable) skill", async () => {
    await apiRequest<{ success: boolean }>(`/api/skills/${minimalSkillId}`, {
      method: "DELETE",
      token: owner.token,
    });
    await apiRequest<{ error: string }>(`/api/skills/${minimalSkillId}`, {
      expectedStatus: 404,
    });
  });

  // =====================
  // Summary
  // =====================
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Skills contract tests: ${passed} passed, ${failed} failed`);
  console.log(
    JSON.stringify(
      {
        runId: RUN_ID,
        apiBaseUrl: API_BASE_URL,
        agentId,
        agentSlug,
        skillIds: {
          fullSkillId,
          minimalSkillId,
          postToFeedSkillId,
          aiSkillId,
          scriptSkillId,
          conditionalSkillId,
          parallelSkillId,
        },
        passed,
        failed,
      },
      null,
      2,
    ),
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
