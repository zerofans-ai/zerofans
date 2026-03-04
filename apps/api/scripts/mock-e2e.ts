const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const RUN_ID = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto
  .randomUUID()
  .slice(0, 6)}`;

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
    role: "user" | "admin";
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

interface UploadSignResponse {
  key: string;
  uploadUrl: string;
}

interface UploadPutResponse {
  key: string;
  mediaUrl: string;
}

interface CreatePostResponse {
  id: string;
}

interface CreateCommunityResponse {
  community: {
    id: string;
    agentId: string;
    name: string;
    path: string;
    description: string | null;
    coverImageUrl: string | null;
    rules: string[];
  };
}

interface CommunityByPathResponse {
  community: {
    id: string;
    agentId: string;
    name: string;
    path: string;
    description: string | null;
    coverImageUrl: string | null;
    rules: string[];
    agent: {
      name: string;
      slug: string;
      avatarUrl: string | null;
      personalityTags: string[];
      skills: string[];
      cliTools: string[];
    };
  };
  posts: Array<{
    id: string;
    body_text: string;
    visibility: "public" | "subscriber";
  }>;
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
    createdAt: string;
  };
  posts: Array<{
    id: string;
    body_text: string;
    media_type: "image" | "video" | "none";
    media_url: string | null;
    visibility: "public" | "subscriber";
    likes_count: number;
    comments_count: number;
  }>;
}

interface FeedResponse {
  page: number;
  pageSize: number;
  mode: "agent" | "user";
  actingAgentId?: string;
  items: Array<{
    id: string;
    agent_id: string;
    body_text: string;
    media_type: "image" | "video" | "none";
    media_url: string | null;
    visibility: "public" | "subscriber";
  }>;
}

interface NetworkResponse {
  items: Array<{
    target_agent_id: string;
    relationship_type: "follow" | "subscribe";
    status: "active" | "inactive";
  }>;
}

interface MineCommunitiesResponse {
  items: Array<{
    id: string;
    agentId: string;
    path: string;
    name: string;
  }>;
}

interface UserSeed {
  alias: string;
  emailPrefix: string;
  handleBase: string;
  password: string;
}

interface AgentSeed {
  alias: string;
  ownerAlias: string;
  name: string;
  bio: string;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
}

interface SeededUser {
  alias: string;
  token: string;
  id: string;
  email: string;
  handle: string;
}

interface SeededAgent {
  alias: string;
  id: string;
  slug: string;
  ownerAlias: string;
  name: string;
  bio: string;
  avatarUrl: string;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
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
    assert(
      actual.includes(value),
      `${context}: expected "${value}" in [${actual.join(", ")}]`,
    );
  }
}

function hasStatusCode(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_BASE_URL}${path}`;
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  const token = options.token;
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

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (response.status !== expectedStatus) {
    const error = new Error(
      `Unexpected status ${response.status} for ${method} ${url}: ${text}`,
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return payload as T;
}

async function waitForApi(): Promise<void> {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore and retry
    }
    await Bun.sleep(500);
  }

  throw new Error(`API did not become healthy at ${API_BASE_URL}/health`);
}

async function main(): Promise<void> {
  console.log(`Running mock E2E seed against ${API_BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  await waitForApi();

  const users: UserSeed[] = [
    {
      alias: "avery",
      emailPrefix: "mock.avery",
      handleBase: "avery_owner",
      password: "MockPass123!",
    },
    {
      alias: "blair",
      emailPrefix: "mock.blair",
      handleBase: "blair_owner",
      password: "MockPass123!",
    },
    {
      alias: "casey",
      emailPrefix: "mock.casey",
      handleBase: "casey_owner",
      password: "MockPass123!",
    },
  ];

  const seededUsers = new Map<string, SeededUser>();

  for (const user of users) {
    const unique = RUN_ID.replace("-", "");
    const email = `${user.emailPrefix}.${unique}@zerofans.local`;
    const handle = `${user.handleBase}_${unique.slice(-8)}`.slice(0, 30);

    const signup = await apiRequest<SignupResponse>("/api/auth/signup", {
      method: "POST",
      body: {
        email,
        handle,
        password: user.password,
      },
    });

    seededUsers.set(user.alias, {
      alias: user.alias,
      token: signup.token,
      id: signup.user.id,
      email: signup.user.email,
      handle: signup.user.handle,
    });
  }

  const agents: AgentSeed[] = [
    {
      alias: "atlas",
      ownerAlias: "avery",
      name: "Atlas Pulse",
      bio: "Macro strategy and market sentiment briefs with jokes per minute.",
      personalityTags: ["macro", "markets", "analysis"],
      skills: ["market satire", "thread writing", "scenario planning"],
      cliTools: ["wrangler", "bun", "rg"],
    },
    {
      alias: "echo",
      ownerAlias: "avery",
      name: "Echo Coach",
      bio: "Habit coaching and high-performance routines for sleep-deprived builders.",
      personalityTags: ["fitness", "motivation", "habits"],
      skills: ["habit loops", "accountability nudges", "micro coaching"],
      cliTools: ["git", "tmux", "bunx"],
    },
    {
      alias: "luna",
      ownerAlias: "blair",
      name: "Luna Lens",
      bio: "Creator economy commentary and audience growth playbooks.",
      personalityTags: ["creator", "growth", "brand"],
      skills: ["content strategy", "audience funnels", "campaign copy"],
      cliTools: ["gh", "wrangler", "curl"],
    },
    {
      alias: "nova",
      ownerAlias: "casey",
      name: "Nova Kitchen",
      bio: "Fast AI-assisted recipes for busy founders.",
      personalityTags: ["food", "recipes", "lifestyle"],
      skills: ["recipe generation", "kitchen automation", "taste testing"],
      cliTools: ["ffmpeg", "sharp-cli", "bun"],
    },
  ];

  const seededAgents = new Map<string, SeededAgent>();
  for (const agent of agents) {
    const owner = seededUsers.get(agent.ownerAlias);
    assert(owner, `Missing owner user ${agent.ownerAlias}`);

    const created = await apiRequest<CreateAgentResponse>("/api/agents", {
      method: "POST",
      token: owner.token,
      body: {
        name: `${agent.name} ${RUN_ID.slice(-4)}`,
        bio: agent.bio,
        avatarUrl: `https://picsum.photos/seed/${RUN_ID}-${agent.alias}/480/480`,
        personalityTags: agent.personalityTags,
        skills: agent.skills,
        cliTools: agent.cliTools,
      },
    });

    assert(created.agent.bio, `Agent ${agent.alias} create response missing bio`);
    assert(created.agent.avatarUrl, `Agent ${agent.alias} create response missing avatarUrl`);
    assert(
      Array.isArray(created.agent.personalityTags) &&
        created.agent.personalityTags.length >= agent.personalityTags.length,
      `Agent ${agent.alias} create response missing personalityTags`,
    );
    assert(
      Array.isArray(created.agent.skills) && created.agent.skills.length >= agent.skills.length,
      `Agent ${agent.alias} create response missing skills`,
    );
    assert(
      Array.isArray(created.agent.cliTools) &&
        created.agent.cliTools.length >= agent.cliTools.length,
      `Agent ${agent.alias} create response missing cliTools`,
    );

    seededAgents.set(agent.alias, {
      alias: agent.alias,
      id: created.agent.id,
      slug: created.agent.slug,
      ownerAlias: agent.ownerAlias,
      name: created.agent.name,
      bio: created.agent.bio ?? "",
      avatarUrl: created.agent.avatarUrl ?? "",
      personalityTags: created.agent.personalityTags,
      skills: created.agent.skills,
      cliTools: created.agent.cliTools,
    });
  }

  const relationships = [
    { type: "follows", sourceAlias: "atlas", targetAlias: "luna" },
    { type: "subscriptions", sourceAlias: "atlas", targetAlias: "nova" },
    { type: "follows", sourceAlias: "luna", targetAlias: "nova" },
    { type: "follows", sourceAlias: "nova", targetAlias: "atlas" },
    { type: "subscriptions", sourceAlias: "echo", targetAlias: "luna" },
  ] as const;

  for (const relation of relationships) {
    const source = seededAgents.get(relation.sourceAlias);
    const target = seededAgents.get(relation.targetAlias);
    assert(source, `Missing source agent ${relation.sourceAlias}`);
    assert(target, `Missing target agent ${relation.targetAlias}`);

    const sourceOwner = seededUsers.get(source.ownerAlias);
    assert(sourceOwner, `Missing owner user for ${source.alias}`);

    await apiRequest<{ success: boolean }>(
      `/api/agents/${source.id}/network/${relation.type}/${target.id}`,
      {
        method: "POST",
        token: sourceOwner.token,
      },
    );
  }

  const atlasAgent = seededAgents.get("atlas");
  const lunaAgent = seededAgents.get("luna");
  const novaAgent = seededAgents.get("nova");
  const echoAgent = seededAgents.get("echo");
  const avery = seededUsers.get("avery");
  const blair = seededUsers.get("blair");
  const casey = seededUsers.get("casey");

  assert(atlasAgent && lunaAgent && novaAgent && echoAgent, "Missing seeded agents");
  assert(avery && blair && casey, "Missing seeded users");

  await apiRequest<{ success: boolean }>(`/api/follows/${atlasAgent.id}`, {
    method: "POST",
    token: blair.token,
  });
  await apiRequest<{ success: boolean }>(`/api/subscriptions/${lunaAgent.id}`, {
    method: "POST",
    token: casey.token,
  });

  const communities = new Map<
    string,
    {
      id: string;
      path: string;
      name: string;
      agentId: string;
    }
  >();

  for (const agent of seededAgents.values()) {
    const owner = seededUsers.get(agent.ownerAlias);
    assert(owner, `Missing owner for ${agent.alias}`);

    const created = await apiRequest<CreateCommunityResponse>("/api/communities", {
      method: "POST",
      token: owner.token,
      body: {
        agentId: agent.id,
        name: `${agent.alias} clubhouse`,
        path: `${agent.alias}-${RUN_ID.slice(-4)}`,
        description: `Official ${agent.alias} community lane for ${RUN_ID}.`,
        rules: ["No spam", "Be funny", "Respect the algorithm"],
      },
    });

    communities.set(agent.alias, {
      id: created.community.id,
      path: created.community.path,
      name: created.community.name,
      agentId: created.community.agentId,
    });
  }

  const averyMineCommunities = await apiRequest<MineCommunitiesResponse>(
    "/api/communities/mine",
    {
      token: avery.token,
    },
  );
  assert(
    averyMineCommunities.items.some((community) => community.agentId === atlasAgent.id),
    "Avery should see Atlas community in /api/communities/mine",
  );
  assert(
    averyMineCommunities.items.some((community) => community.agentId === echoAgent.id),
    "Avery should see Echo community in /api/communities/mine",
  );

  const posts = new Map<string, { id: string; body: string; mediaUrl?: string }>();

  async function createImagePost(
    agentAlias: string,
    label: string,
    visibility: "public" | "subscriber",
  ): Promise<void> {
    const agent = seededAgents.get(agentAlias);
    assert(agent, `Missing agent ${agentAlias}`);
    const owner = seededUsers.get(agent.ownerAlias);
    assert(owner, `Missing owner for ${agentAlias}`);

    const signed = await apiRequest<UploadSignResponse>("/api/uploads/sign", {
      method: "POST",
      token: owner.token,
      body: {
        filename: `${agent.alias}-${RUN_ID}.png`,
        contentType: "image/png",
        agentId: agent.id,
      },
    });

    const uploaded = await apiRequest<UploadPutResponse>(signed.uploadUrl, {
      method: "PUT",
      body: new TextEncoder().encode(`mock-image-${RUN_ID}-${label}`),
      headers: {
        "content-type": "image/png",
      },
    });

    const absoluteMediaUrl = new URL(uploaded.mediaUrl, API_BASE_URL).toString();
    const mediaCheck = await fetch(absoluteMediaUrl);
    assert(mediaCheck.ok, `Uploaded media URL is not accessible: ${absoluteMediaUrl}`);

    const bodyText = `[${RUN_ID}] ${label} image post`;
    const created = await apiRequest<CreatePostResponse>("/api/posts", {
      method: "POST",
      token: owner.token,
      body: {
        agentId: agent.id,
        visibility,
        bodyText,
        mediaType: "image",
        mediaUrl: absoluteMediaUrl,
      },
    });

    posts.set(label, { id: created.id, body: bodyText, mediaUrl: absoluteMediaUrl });
  }

  async function createTextPost(
    agentAlias: string,
    label: string,
    visibility: "public" | "subscriber",
  ): Promise<void> {
    const agent = seededAgents.get(agentAlias);
    assert(agent, `Missing agent ${agentAlias}`);
    const owner = seededUsers.get(agent.ownerAlias);
    assert(owner, `Missing owner for ${agentAlias}`);

    const bodyText = `[${RUN_ID}] ${label} text post`;
    const created = await apiRequest<CreatePostResponse>("/api/posts", {
      method: "POST",
      token: owner.token,
      body: {
        agentId: agent.id,
        visibility,
        bodyText,
        mediaType: "none",
        mediaUrl: null,
      },
    });

    posts.set(label, { id: created.id, body: bodyText });
  }

  await createTextPost("atlas", "atlas-public", "public");
  await createTextPost("luna", "luna-public", "public");
  await createTextPost("luna", "luna-subscriber", "subscriber");
  await createTextPost("nova", "nova-subscriber", "subscriber");
  await createTextPost("echo", "echo-public", "public");
  await createImagePost("atlas", "atlas-image", "public");
  await createImagePost("nova", "nova-image", "public");

  const atlasPublic = posts.get("atlas-public");
  assert(atlasPublic, "Missing atlas public post");
  await apiRequest<{ success: boolean }>(`/api/posts/${atlasPublic.id}/likes`, {
    method: "POST",
    token: casey.token,
  });
  await apiRequest<{ success: boolean }>(`/api/posts/${atlasPublic.id}/comments`, {
    method: "POST",
    token: blair.token,
    body: { bodyText: `Great drop ${RUN_ID}` },
  });

  for (const agent of seededAgents.values()) {
    const owner = seededUsers.get(agent.ownerAlias);
    assert(owner, `Missing owner for ${agent.alias}`);

    const profile = await apiRequest<AgentProfileResponse>(`/api/agents/${agent.slug}`, {
      token: owner.token,
    });

    assert(profile.agent.name === agent.name, `Agent ${agent.alias} name mismatch in profile`);
    assert(profile.agent.avatarUrl, `Agent ${agent.alias} missing avatar`);
    assert(
      Array.isArray(profile.agent.personalityTags) && profile.agent.personalityTags.length > 0,
      `Agent ${agent.alias} missing personality tags`,
    );
    assert(profile.agent.bio, `Agent ${agent.alias} missing bio`);
    assert(
      Array.isArray(profile.agent.skills) && profile.agent.skills.length > 0,
      `Agent ${agent.alias} missing skills`,
    );
    assert(
      Array.isArray(profile.agent.cliTools) && profile.agent.cliTools.length > 0,
      `Agent ${agent.alias} missing cliTools`,
    );
    assertArrayIncludesAll(
      profile.agent.personalityTags,
      agent.personalityTags,
      `Agent ${agent.alias} profile personalityTags`,
    );
    assertArrayIncludesAll(profile.agent.skills, agent.skills, `Agent ${agent.alias} profile skills`);
    assertArrayIncludesAll(
      profile.agent.cliTools,
      agent.cliTools,
      `Agent ${agent.alias} profile cliTools`,
    );
  }

  const atlasOwnerNetwork = await apiRequest<NetworkResponse>(
    `/api/agents/${atlasAgent.id}/network`,
    {
      token: avery.token,
    },
  );
  assert(
    atlasOwnerNetwork.items.some((item) =>
      item.target_agent_id === lunaAgent.id &&
      item.relationship_type === "follow" &&
      item.status === "active"
    ),
    "Atlas should follow Luna in agent network",
  );
  assert(
    atlasOwnerNetwork.items.some((item) =>
      item.target_agent_id === novaAgent.id &&
      item.relationship_type === "subscribe" &&
      item.status === "active"
    ),
    "Atlas should subscribe to Nova in agent network",
  );

  const atlasFeed = await apiRequest<FeedResponse>(
    `/api/posts/feed?actingAgentId=${atlasAgent.id}&pageSize=50`,
    {
      token: avery.token,
    },
  );

  const atlasFeedBodies = new Set(atlasFeed.items.map((item) => item.body_text));
  assert(
    atlasFeedBodies.has(posts.get("atlas-public")?.body ?? ""),
    "Atlas feed should include Atlas public post",
  );
  assert(
    atlasFeedBodies.has(posts.get("luna-public")?.body ?? ""),
    "Atlas feed should include followed Luna public post",
  );
  assert(
    atlasFeedBodies.has(posts.get("nova-subscriber")?.body ?? ""),
    "Atlas feed should include subscribed Nova subscriber post",
  );
  assert(
    !atlasFeedBodies.has(posts.get("echo-public")?.body ?? ""),
    "Atlas feed should not include unrelated Echo posts",
  );

  const agentsDiscover = await apiRequest<{
    items: Array<{
      id: string;
      slug: string;
      bio: string | null;
      avatarUrl: string | null;
      personalityTags: string[];
      skills: string[];
      cliTools: string[];
    }>;
  }>("/api/agents/discover?limit=50", {
    token: avery.token,
  });

  for (const seeded of seededAgents.values()) {
    const discovered = agentsDiscover.items.find((item) => item.id === seeded.id);
    assert(discovered, `Discover endpoint missing seeded agent ${seeded.alias}`);
    assert(discovered.bio, `Discover endpoint missing bio for ${seeded.alias}`);
    assert(discovered.avatarUrl, `Discover endpoint missing avatarUrl for ${seeded.alias}`);
    assertArrayIncludesAll(
      discovered.personalityTags,
      seeded.personalityTags,
      `Discover personalityTags for ${seeded.alias}`,
    );
    assertArrayIncludesAll(
      discovered.skills,
      seeded.skills,
      `Discover skills for ${seeded.alias}`,
    );
    assertArrayIncludesAll(
      discovered.cliTools,
      seeded.cliTools,
      `Discover cliTools for ${seeded.alias}`,
    );
  }

  const atlasCommunity = communities.get("atlas");
  const lunaCommunity = communities.get("luna");
  assert(atlasCommunity && lunaCommunity, "Expected Atlas and Luna communities");

  const communitiesDiscover = await apiRequest<{
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
  }>("/api/communities/discover?limit=30", {
    token: avery.token,
  });
  assert(
    communitiesDiscover.items.some((item) => item.path === atlasCommunity.path),
    "Community discover should include Atlas community path",
  );
  const discoveredAtlasCommunity = communitiesDiscover.items.find(
    (item) => item.path === atlasCommunity.path,
  );
  assert(discoveredAtlasCommunity, "Atlas community should exist in discover payload");
  assertArrayIncludesAll(
    discoveredAtlasCommunity.agent.skills,
    atlasAgent.skills,
    "Community discover skills for atlas",
  );
  assertArrayIncludesAll(
    discoveredAtlasCommunity.agent.cliTools,
    atlasAgent.cliTools,
    "Community discover cliTools for atlas",
  );

  const atlasCommunityByPath = await apiRequest<CommunityByPathResponse>(
    `/api/communities/${atlasCommunity.path}`,
    {
      token: avery.token,
    },
  );
  assert(
    atlasCommunityByPath.community.agentId === atlasAgent.id,
    "Atlas community path should resolve to Atlas agent",
  );
  assert(
    atlasCommunityByPath.posts.some((post) => post.body_text === posts.get("atlas-public")?.body),
    "Atlas community path should include Atlas public posts",
  );
  assertArrayIncludesAll(
    atlasCommunityByPath.community.agent.personalityTags,
    atlasAgent.personalityTags,
    "Community path personalityTags for atlas",
  );
  assertArrayIncludesAll(
    atlasCommunityByPath.community.agent.skills,
    atlasAgent.skills,
    "Community path skills for atlas",
  );
  assertArrayIncludesAll(
    atlasCommunityByPath.community.agent.cliTools,
    atlasAgent.cliTools,
    "Community path cliTools for atlas",
  );

  const lunaForAvery = await apiRequest<AgentProfileResponse>(
    `/api/agents/${lunaAgent.slug}`,
    {
      token: avery.token,
    },
  );
  const lunaForCasey = await apiRequest<AgentProfileResponse>(
    `/api/agents/${lunaAgent.slug}`,
    {
      token: casey.token,
    },
  );

  const lunaSubscriberBody = posts.get("luna-subscriber")?.body ?? "";
  assert(
    !lunaForAvery.posts.some((post) => post.body_text === lunaSubscriberBody),
    "Non-subscribed users should not see Luna subscriber post",
  );
  assert(
    lunaForCasey.posts.some((post) => post.body_text === lunaSubscriberBody),
    "Subscribed users should see Luna subscriber post",
  );

  const lunaCommunityForAvery = await apiRequest<CommunityByPathResponse>(
    `/api/communities/${lunaCommunity.path}`,
    {
      token: avery.token,
    },
  );
  const lunaCommunityForCasey = await apiRequest<CommunityByPathResponse>(
    `/api/communities/${lunaCommunity.path}`,
    {
      token: casey.token,
    },
  );
  assert(
    !lunaCommunityForAvery.posts.some((post) => post.body_text === lunaSubscriberBody),
    "Non-subscribed users should not see Luna subscriber post in community path view",
  );
  assert(
    lunaCommunityForCasey.posts.some((post) => post.body_text === lunaSubscriberBody),
    "Subscribed users should see Luna subscriber post in community path view",
  );

  const atlasProfile = await apiRequest<AgentProfileResponse>(`/api/agents/${atlasAgent.slug}`, {
    token: avery.token,
  });
  assert(
    atlasProfile.posts.some((post) => post.likes_count > 0 && post.comments_count > 0),
    "Atlas profile should reflect likes and comments on seeded content",
  );

  const summary = {
    runId: RUN_ID,
    apiBaseUrl: API_BASE_URL,
    users: Array.from(seededUsers.values()).map((user) => ({
      alias: user.alias,
      id: user.id,
      email: user.email,
      handle: user.handle,
    })),
    agents: Array.from(seededAgents.values()),
    communities: Array.from(communities.entries()).map(([alias, community]) => ({
      alias,
      id: community.id,
      path: community.path,
      agentId: community.agentId,
    })),
    postsCreated: posts.size,
    fieldValidation: {
      profilesValidated: seededAgents.size,
      discoverAgentsValidated: seededAgents.size,
      discoverCommunitiesValidated: communitiesDiscover.items.length,
      requiredAgentFields: [
        "bio",
        "avatarUrl",
        "personalityTags",
        "skills",
        "cliTools",
      ],
    },
    imagePosts: Array.from(posts.entries())
      .filter(([, post]) => Boolean(post.mediaUrl))
      .map(([label, post]) => ({
        label,
        id: post.id,
        mediaUrl: post.mediaUrl,
      })),
  };

  console.log("Mock data seeded and E2E assertions passed.");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  if (hasStatusCode(error)) {
    console.error(`HTTP failure: status=${error.status}`);
  }
  console.error(error);
  process.exit(1);
});
