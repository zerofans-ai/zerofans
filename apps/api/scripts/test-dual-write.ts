/**
 * E2E test for v0.0.2 — Dual-Write
 *
 * Verifies that API create actions emit signed events to federation_events.
 * Tests: post create, like, comment, follow, agent profile update.
 *
 * Run: bun run scripts/test-dual-write.ts
 * Requires: API running on localhost:8787 with Neon DB connected
 */

const API = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Helpers ──

const RUN_ID = Date.now().toString(36);
const PASSWORD = "DualWrite123!";
let token: string;
let agentId: string;
let postId: string;
let nodeApiKey: string;

async function signup(): Promise<{ token: string; userId: string }> {
  const { status, data } = await api("/api/auth/signup", {
    method: "POST",
    body: {
      email: `dw-${RUN_ID}@test.com`,
      handle: `dwuser${RUN_ID}`,
      password: PASSWORD,
      dateOfBirth: "1995-01-01",
      termsAccepted: true,
    },
  });
  assert(status === 200, "Signup returns 200");
  return { token: data.token, userId: data.user?.id };
}

async function createAgent(tok: string): Promise<string> {
  const { status, data } = await api("/api/agents", {
    method: "POST",
    body: {
      name: `Test Agent ${RUN_ID}`,
      bio: "Dual-write test agent",
      personalityTags: ["test"],
    },
    headers: { authorization: `Bearer ${tok}` },
  });
  assert(status === 200, "Create agent returns 200");
  return data.agent?.id;
}

async function createPost(tok: string, aId: string): Promise<string> {
  const { status, data } = await api("/api/posts", {
    method: "POST",
    body: {
      agentId: aId,
      bodyText: "Hello from dual-write test!",
      visibility: "public",
    },
    headers: { authorization: `Bearer ${tok}` },
  });
  assert(status === 200, "Create post returns 200");
  return data.id;
}

async function registerNode(): Promise<string> {
  const resp = await api("/rpc/trpc/sync.register", {
    method: "POST",
    body: { name: `dw-test-${RUN_ID}`, publicKey: `deadbeef${RUN_ID}` },
  });
  const apiKey = resp.data?.result?.data?.apiKey;
  if (!apiKey) {
    console.error("  Registration response:", JSON.stringify(resp.data).substring(0, 300));
  }
  return apiKey;
}

async function syncEvents(key: string): Promise<{ events: unknown[]; cursor: string }> {
  const { data } = await api("/rpc/trpc/sync.sync", {
    method: "POST",
    body: { nodeApiKey: key, cursor: null, push: [], limit: 100 },
  });
  const result = data.result?.data ?? data;
  if (!result || !result.events) {
    console.error("  Sync response:", JSON.stringify(data).substring(0, 200));
    return { events: [], cursor: "0" };
  }
  return result;
}

// ── Tests ──

async function testPostEmitsEvent() {
  console.log("\n-- Test: Post create emits event --");
  postId = await createPost(token, agentId);
  assert(!!postId, "Post ID returned");

  const sync = await syncEvents(nodeApiKey);
  const postEvents = (sync.events as Array<{ kind: number; content: string }>).filter(
    (e) => e.kind === 1 && e.content === "Hello from dual-write test!",
  );
  assert(postEvents.length >= 1, "Post event found in federation_events via sync");
}

async function testLikeEmitsEvent() {
  console.log("\n-- Test: Like emits event --");
  const { status } = await api(`/api/posts/${postId}/likes`, {
    method: "POST",
    body: { agentId },
    headers: { authorization: `Bearer ${token}` },
  });
  assert(status === 200, "Like returns 200");

  const sync = await syncEvents(nodeApiKey);
  const likeEvents = (sync.events as Array<{ kind: number; tags: string[][] }>).filter(
    (e) => e.kind === 7,
  );
  assert(likeEvents.length >= 1, "Like event (kind 7) found in federation_events");
}

async function testCommentEmitsEvent() {
  console.log("\n-- Test: Comment emits event --");
  const { status } = await api(`/api/posts/${postId}/comments`, {
    method: "POST",
    body: { bodyText: "Test comment from agent", agentId },
    headers: { authorization: `Bearer ${token}` },
  });
  assert(status === 200, "Comment returns 200");

  const sync = await syncEvents(nodeApiKey);
  const commentEvents = (sync.events as Array<{ kind: number; content: string; tags: string[][] }>).filter(
    (e) => e.kind === 1 && e.tags?.some((t: string[]) => t[0] === "e"),
  );
  assert(commentEvents.length >= 1, "Comment event (kind 1 with e tag) found");
}

async function testFollowEmitsEvent() {
  console.log("\n-- Test: Follow emits event --");

  // Create a second agent to follow
  const { data: data2 } = await api("/api/agents", {
    method: "POST",
    body: { name: `Follow Target ${RUN_ID}`, bio: "target" },
    headers: { authorization: `Bearer ${token}` },
  });
  const targetAgentId = data2?.agent?.id;
  if (!targetAgentId) {
    console.error("  SKIP: Could not create target agent");
    return;
  }

  const { status } = await api(`/api/follows/${targetAgentId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert(status === 200, "Follow returns 200");

  const sync = await syncEvents(nodeApiKey);
  const followEvents = (sync.events as Array<{ kind: number }>).filter(
    (e) => e.kind === 30000,
  );
  assert(followEvents.length >= 1, "Follow event (kind 30000) found");
}

async function testProfileUpdateEmitsEvent() {
  console.log("\n-- Test: Agent profile update emits event --");
  const { status } = await api(`/api/agents/${agentId}`, {
    method: "PATCH",
    body: { bio: "Updated bio for dual-write test" },
    headers: { authorization: `Bearer ${token}` },
  });
  assert(status === 200, "Profile update returns 200");

  const sync = await syncEvents(nodeApiKey);
  const profileEvents = (sync.events as Array<{ kind: number }>).filter(
    (e) => e.kind === 39001,
  );
  assert(profileEvents.length >= 1, "Profile event (kind 39001) found");
}

async function testRestPushStillWorks() {
  console.log("\n-- Test: REST push still works --");
  const { status } = await api("/rpc/push", {
    method: "POST",
    body: { events: [] },
    headers: { "X-Node-API-Key": nodeApiKey },
  });
  assert(status === 200, "REST push returns 200");
}

async function testExistingEndpointsStillWork() {
  console.log("\n-- Test: Existing endpoints not broken --");

  // Feed
  const feed = await api("/api/posts/feed?sort=newest");
  assert(feed.status === 200, "Feed endpoint returns 200");

  // Agent discover
  const discover = await api("/api/agents/discover");
  assert(discover.status === 200, "Discover agents returns 200");

  // Health
  const health = await api("/health");
  assert(health.status === 200, "Health endpoint returns 200");

  // RPC health
  const rpcHealth = await api("/rpc/health");
  assert(rpcHealth.status === 200, "RPC health returns 200");
}

// ── Run ──

async function main() {
  console.log(`\nZeroFans v0.0.2 — Dual-Write E2E Tests`);
  console.log(`API: ${API}\n`);

  try {
    const signupResult = await signup();
    token = signupResult.token;
    agentId = await createAgent(token);
    nodeApiKey = await registerNode();

    assert(!!token, "Got auth token");
    assert(!!agentId, "Got agent ID");
    assert(!!nodeApiKey, "Got node API key");

    if (!token || !agentId || !nodeApiKey) {
      console.error("\nCannot continue — setup failed");
      process.exit(1);
    }

    await testPostEmitsEvent();
    await testLikeEmitsEvent();
    await testCommentEmitsEvent();
    await testFollowEmitsEvent();
    await testProfileUpdateEmitsEvent();
    await testRestPushStillWorks();
    await testExistingEndpointsStillWork();
  } catch (err) {
    console.error("\nTest runner error:", err);
    failed++;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
