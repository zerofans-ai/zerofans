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
  headers?: HeadersInit;
}

interface SignupResponse {
  token: string;
  user: {
    id: string;
    email: string;
    handle: string;
  };
}

interface CreateAgentResponse {
  agent: {
    id: string;
    ownerUserId: string;
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
  };
}

interface AgentProfileResponse {
  agent: {
    id: string;
    ownerUserId: string;
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
  };
}

interface DiscoverAgentsResponse {
  items: Array<{
    id: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
  }>;
}

interface CreateCommunityResponse {
  community: {
    id: string;
    agentId: string;
    name: string;
    path: string;
  };
}

interface DiscoverCommunitiesResponse {
  items: Array<{
    id: string;
    path: string;
    agentId: string;
    agent: {
      slug: string;
      personalityTags: string[];
      skills: string[];
      cliTools: string[];
    };
  }>;
}

interface CommunityByPathResponse {
  community: {
    id: string;
    path: string;
    agentId: string;
    agent: {
      slug: string;
      personalityTags: string[];
      skills: string[];
      cliTools: string[];
    };
  };
}

interface CreatePostResponse {
  id: string;
}

interface PostByIdResponse {
  post: {
    id: string;
    agent_id: string;
    visibility: "public" | "subscriber";
    body_text: string;
  };
}

interface AiPostResponse {
  post: {
    id: string;
    bodyText: string;
  };
}

interface UsageStatsResponse {
  agents: number;
  users: number;
  posts: number;
  comments: number;
  likes: number;
  subscribers: number;
  newsletterSubscribers: number;
}

interface TextResponse {
  status: number;
  contentType: string;
  body: string;
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

function assertArrayIncludesAll(
  actual: string[],
  expected: string[],
  context: string,
): void {
  for (const value of expected) {
    assert(actual.includes(value), `${context}: expected "${value}" in [${actual.join(", ")}]`);
  }
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const url = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers ?? {});
  const expectedStatus = options.expectedStatus ?? 200;

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (
      typeof options.body === "string" ||
      options.body instanceof ArrayBuffer ||
      ArrayBuffer.isView(options.body)
    ) {
      body = options.body as BodyInit;
    } else {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
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

async function apiRequestText(path: string, expectedStatus = 200): Promise<TextResponse> {
  const url = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_BASE_URL}${path}`;

  const response = await fetch(url);
  const body = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`Unexpected ${response.status} for GET ${url}: ${body}`);
  }

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
  };
}

async function waitForApi(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await Bun.sleep(500);
  }

  throw new Error(`API is not reachable at ${API_BASE_URL}/health`);
}

async function signup(alias: string): Promise<SeedUser> {
  const unique = RUN_ID.replace("-", "");
  const email = `contract.${alias}.${unique}@zerofans.local`;
  const handle = `${alias}_contract_${unique.slice(-8)}`.slice(0, 30);

  const created = await apiRequest<SignupResponse>("/api/auth/signup", {
    method: "POST",
    body: {
      email,
      handle,
      password: PASSWORD,
    },
  });

  return {
    token: created.token,
    id: created.user.id,
    email: created.user.email,
    handle: created.user.handle,
  };
}

async function main(): Promise<void> {
  console.log(`Running API contract test against ${API_BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  await waitForApi();

  const usageStatsBefore = await apiRequest<UsageStatsResponse>("/api/stats/usage");

  const owner = await signup("owner");
  const viewer = await signup("viewer");

  const initialProfile = {
    name: `Contract Bot ${RUN_ID.slice(-4)}`,
    bio: "Contract-first AI agent for field-level schema verification.",
    avatarUrl: `https://picsum.photos/seed/contract-${RUN_ID}/400/400`,
    personalityTags: ["contract", "schema", "qa"],
    skills: ["api validation", "field assertions", "release checks"],
    cliTools: ["bun", "wrangler", "rg"],
  };

  const createdAgent = await apiRequest<CreateAgentResponse>("/api/agents", {
    method: "POST",
    token: owner.token,
    body: initialProfile,
  });

  assert(createdAgent.agent.bio, "Create response missing agent.bio");
  assert(createdAgent.agent.avatarUrl, "Create response missing agent.avatarUrl");
  assertArrayIncludesAll(
    createdAgent.agent.personalityTags,
    initialProfile.personalityTags,
    "Create response personalityTags",
  );
  assertArrayIncludesAll(createdAgent.agent.skills, initialProfile.skills, "Create response skills");
  assertArrayIncludesAll(
    createdAgent.agent.cliTools,
    initialProfile.cliTools,
    "Create response cliTools",
  );

  const patchProfile = {
    name: `${initialProfile.name} Updated`,
    bio: "Updated profile to verify PATCH contract across all consumers.",
    avatarUrl: `https://picsum.photos/seed/contract-updated-${RUN_ID}/400/400`,
    personalityTags: ["contract", "updated", "coverage"],
    skills: ["schema diffing", "contract enforcement", "ci gates"],
    cliTools: ["wrangler", "bun", "git"],
  };

  await apiRequest<{ success: boolean }>(`/api/agents/${createdAgent.agent.id}`, {
    method: "PATCH",
    token: owner.token,
    body: patchProfile,
  });

  const profile = await apiRequest<AgentProfileResponse>(
    `/api/agents/${createdAgent.agent.slug}`,
    {
      token: owner.token,
    },
  );
  assert(profile.agent.bio, "Profile response missing agent.bio");
  assert(profile.agent.avatarUrl, "Profile response missing agent.avatarUrl");
  assertArrayIncludesAll(
    profile.agent.personalityTags,
    patchProfile.personalityTags,
    "Profile personalityTags",
  );
  assertArrayIncludesAll(profile.agent.skills, patchProfile.skills, "Profile skills");
  assertArrayIncludesAll(profile.agent.cliTools, patchProfile.cliTools, "Profile cliTools");

  const discoverAgents = await apiRequest<DiscoverAgentsResponse>(
    `/api/agents/discover?q=${encodeURIComponent(RUN_ID.slice(-4))}&limit=25`,
    {
      token: viewer.token,
    },
  );
  const discoveredAgent = discoverAgents.items.find((item) => item.id === createdAgent.agent.id);
  assert(discoveredAgent, "Discover endpoint missing created agent");
  assert(discoveredAgent.bio, "Discover response missing agent.bio");
  assert(discoveredAgent.avatarUrl, "Discover response missing agent.avatarUrl");
  assertArrayIncludesAll(
    discoveredAgent.personalityTags,
    patchProfile.personalityTags,
    "Discover personalityTags",
  );
  assertArrayIncludesAll(discoveredAgent.skills, patchProfile.skills, "Discover skills");
  assertArrayIncludesAll(discoveredAgent.cliTools, patchProfile.cliTools, "Discover cliTools");

  const createdCommunity = await apiRequest<CreateCommunityResponse>("/api/communities", {
    method: "POST",
    token: owner.token,
    body: {
      agentId: createdAgent.agent.id,
      name: `${patchProfile.name} Community`,
      path: `contract-${RUN_ID.slice(-8)}`,
      description: "Community path contract test lane.",
      rules: ["Field coverage required", "Schema drifts are not allowed"],
    },
  });

  const createdPost = await apiRequest<CreatePostResponse>("/api/posts", {
    method: "POST",
    token: owner.token,
    body: {
      agentId: createdAgent.agent.id,
      visibility: "public",
      bodyText: `Contract post ${RUN_ID}`,
      mediaType: "none",
      mediaUrl: null,
    },
  });
  const postById = await apiRequest<PostByIdResponse>(`/api/posts/${createdPost.id}`, {
    token: viewer.token,
  });
  assert(
    postById.post.id === createdPost.id,
    `Expected GET /api/posts/:postId to return ${createdPost.id}, got ${postById.post.id}`,
  );
  assert(
    postById.post.agent_id === createdAgent.agent.id,
    `Expected post agent_id ${createdAgent.agent.id}, got ${postById.post.agent_id}`,
  );

  await apiRequest<{ success: boolean }>(`/api/posts/${createdPost.id}/likes`, {
    method: "POST",
    token: viewer.token,
  });

  await apiRequest<{ success: boolean }>(`/api/subscriptions/${createdAgent.agent.id}`, {
    method: "POST",
    token: viewer.token,
  });

  await apiRequest<{ ok: boolean }>("/api/email-signups", {
    method: "POST",
    body: {
      email: `newsletter.${RUN_ID}@zerofans.local`,
      source: "contract-suite",
    },
  });

  const discoverCommunities = await apiRequest<DiscoverCommunitiesResponse>(
    `/api/communities/discover?q=${encodeURIComponent(RUN_ID.slice(-8))}&limit=25`,
    {
      token: viewer.token,
    },
  );
  const discoveredCommunity = discoverCommunities.items.find(
    (item) => item.id === createdCommunity.community.id,
  );
  assert(discoveredCommunity, "Community discover missing created community");
  assertArrayIncludesAll(
    discoveredCommunity.agent.personalityTags,
    patchProfile.personalityTags,
    "Community discover personalityTags",
  );
  assertArrayIncludesAll(
    discoveredCommunity.agent.skills,
    patchProfile.skills,
    "Community discover skills",
  );
  assertArrayIncludesAll(
    discoveredCommunity.agent.cliTools,
    patchProfile.cliTools,
    "Community discover cliTools",
  );

  const communityByPath = await apiRequest<CommunityByPathResponse>(
    `/api/communities/${createdCommunity.community.path}`,
    {
      token: viewer.token,
    },
  );
  assert(
    communityByPath.community.agentId === createdAgent.agent.id,
    "Community path resolved to wrong agent",
  );
  assertArrayIncludesAll(
    communityByPath.community.agent.personalityTags,
    patchProfile.personalityTags,
    "Community path personalityTags",
  );
  assertArrayIncludesAll(
    communityByPath.community.agent.skills,
    patchProfile.skills,
    "Community path skills",
  );
  assertArrayIncludesAll(
    communityByPath.community.agent.cliTools,
    patchProfile.cliTools,
    "Community path cliTools",
  );

  const aiPost = await apiRequest<AiPostResponse>(
    `/api/ai/agents/${createdAgent.agent.id}/update-content`,
    {
      method: "POST",
      token: owner.token,
      body: {
        prompt: "Write a short update about being an API contract guardian.",
        visibility: "public",
        mediaType: "none",
        mediaUrl: null,
      },
    },
  );
  assert(aiPost.post.bodyText.length > 0, "AI update-content returned empty bodyText");

  const usageStatsAfter = await apiRequest<UsageStatsResponse>("/api/stats/usage");

  assert(
    usageStatsAfter.users >= usageStatsBefore.users + 2,
    `Usage stats users should increase by at least 2 (before=${usageStatsBefore.users}, after=${usageStatsAfter.users})`,
  );
  assert(
    usageStatsAfter.agents >= usageStatsBefore.agents + 1,
    `Usage stats agents should increase by at least 1 (before=${usageStatsBefore.agents}, after=${usageStatsAfter.agents})`,
  );
  assert(
    usageStatsAfter.posts >= usageStatsBefore.posts + 2,
    `Usage stats posts should increase by at least 2 (before=${usageStatsBefore.posts}, after=${usageStatsAfter.posts})`,
  );
  assert(
    usageStatsAfter.likes >= usageStatsBefore.likes + 1,
    `Usage stats likes should increase by at least 1 (before=${usageStatsBefore.likes}, after=${usageStatsAfter.likes})`,
  );
  assert(
    usageStatsAfter.subscribers >= usageStatsBefore.subscribers + 1,
    `Usage stats subscribers should increase by at least 1 (before=${usageStatsBefore.subscribers}, after=${usageStatsAfter.subscribers})`,
  );
  assert(
    usageStatsAfter.newsletterSubscribers >= usageStatsBefore.newsletterSubscribers + 1,
    `Usage stats newsletterSubscribers should increase by at least 1 (before=${usageStatsBefore.newsletterSubscribers}, after=${usageStatsAfter.newsletterSubscribers})`,
  );

  const dynamicSitemapAlias = await apiRequestText("/api/seo/sitemap.xml");
  assert(
    dynamicSitemapAlias.contentType.includes("application/xml"),
    `Dynamic sitemap alias content-type should be XML, got "${dynamicSitemapAlias.contentType}"`,
  );
  assert(
    dynamicSitemapAlias.body.includes("<sitemapindex"),
    "Dynamic sitemap alias should return sitemap index XML",
  );

  const sitemapIndex = await apiRequestText("/api/seo/sitemap-index.xml");
  assert(
    sitemapIndex.contentType.includes("application/xml"),
    `Sitemap index content-type should be XML, got "${sitemapIndex.contentType}"`,
  );
  assert(sitemapIndex.body.includes("<sitemapindex"), "Sitemap index is not valid XML");
  assert(
    sitemapIndex.body.includes("/api/seo/sitemaps/core.xml</loc>"),
    "Sitemap index missing core sitemap shard",
  );
  assert(
    sitemapIndex.body.includes("/api/seo/sitemaps/agents/1</loc>"),
    "Sitemap index missing agents shard",
  );
  assert(
    sitemapIndex.body.includes("/api/seo/sitemaps/communities/1</loc>"),
    "Sitemap index missing communities shard",
  );
  assert(
    sitemapIndex.body.includes("/api/seo/sitemaps/posts/1</loc>"),
    "Sitemap index missing posts shard",
  );

  const coreSitemap = await apiRequestText("/api/seo/sitemaps/core.xml");
  assert(coreSitemap.body.includes("<urlset"), "Core sitemap response is not a urlset XML document");
  assert(coreSitemap.body.includes("/</loc>"), "Core sitemap missing root URL");
  assert(coreSitemap.body.includes("/community</loc>"), "Core sitemap missing community URL");

  const agentsSitemap = await apiRequestText("/api/seo/sitemaps/agents/1");
  assert(
    agentsSitemap.body.includes(`/agents/${createdAgent.agent.slug}</loc>`),
    "Agents shard missing created agent profile URL",
  );

  const communitiesSitemap = await apiRequestText("/api/seo/sitemaps/communities/1");
  assert(
    communitiesSitemap.body.includes(`/community/${createdCommunity.community.path}</loc>`),
    "Communities shard missing created community URL",
  );

  const postsSitemap = await apiRequestText("/api/seo/sitemaps/posts/1");
  assert(
    postsSitemap.body.includes(`/posts/${createdPost.id}</loc>`),
    "Posts shard missing created post URL",
  );

  console.log("API contract assertions passed.");
  console.log(
    JSON.stringify(
      {
        runId: RUN_ID,
        apiBaseUrl: API_BASE_URL,
        agentId: createdAgent.agent.id,
        agentSlug: createdAgent.agent.slug,
        communityPath: createdCommunity.community.path,
        requiredAgentFields: [
          "bio",
          "avatarUrl",
          "personalityTags",
          "skills",
          "cliTools",
        ],
        validatedEndpoints: [
          "POST /api/agents",
          "PATCH /api/agents/:agentId",
          "GET /api/agents/:slug",
          "GET /api/agents/discover",
          "GET /api/communities/discover",
          "GET /api/communities/:path",
          "POST /api/posts",
          "GET /api/posts/:postId",
          "PATCH /api/posts/:postId",
          "POST /api/posts/:postId/likes",
          "POST /api/posts/:postId/comments",
          "POST /api/subscriptions/:agentId",
          "POST /api/email-signups",
          "GET /api/stats/usage",
          "GET /api/seo/sitemap.xml",
          "GET /api/seo/sitemap-index.xml",
          "GET /api/seo/sitemaps/core.xml",
          "GET /api/seo/sitemaps/agents/:page",
          "GET /api/seo/sitemaps/communities/:page",
          "GET /api/seo/sitemaps/posts/:page",
          "POST /api/ai/agents/:agentId/update-content",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
