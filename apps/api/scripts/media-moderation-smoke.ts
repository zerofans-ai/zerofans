import { issueAccessToken } from "../src/lib/jwt";
import type { EnvBindings } from "../src/types/env";

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
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

interface SeedUser {
  id: string;
  email: string;
  handle: string;
  token: string;
}

interface CreateAgentResponse {
  agent: {
    id: string;
    slug: string;
  };
}

interface UploadSignResponse {
  key: string;
  maxBytes: number;
  mediaType: "image" | "video" | null;
  requiresModeration: boolean;
  uploadUrl: string;
}

interface UploadPutResponse {
  key: string;
  mediaUrl: string;
  moderationStatus: "pending" | "approved" | "rejected" | "review";
  moderationReason?: string | null;
}

interface ModerationListResponse {
  items: Array<{
    mediaKey: string;
    status: "pending" | "approved" | "rejected" | "review";
  }>;
}

interface ReviewResponse {
  success: boolean;
  mediaKey: string;
  status: "approved" | "rejected" | "review";
}

interface CreatePostResponse {
  id: string;
}

interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseDotEnv(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    const unquoted =
      rawValue.startsWith("\"") && rawValue.endsWith("\"")
        ? rawValue.slice(1, -1)
        : rawValue;
    output[key] = unquoted;
  }
  return output;
}

function normalizeSignedUploadUrl(uploadUrl: string): string {
  try {
    const signed = new URL(uploadUrl);
    const apiBase = new URL(API_BASE_URL);
    const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

    if (localHosts.has(apiBase.hostname) && !localHosts.has(signed.hostname)) {
      return new URL(`${signed.pathname}${signed.search}`, API_BASE_URL).toString();
    }

    return signed.toString();
  } catch {
    return new URL(uploadUrl, API_BASE_URL).toString();
  }
}

async function loadJwtConfig(): Promise<JwtConfig> {
  const envFile = Bun.file(".dev.vars");
  const envFileVars = (await envFile.exists()) ? parseDotEnv(await envFile.text()) : {};

  const secret = process.env.JWT_SECRET ?? envFileVars.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required (set it in apps/api/.dev.vars or process env).");
  }

  return {
    secret,
    issuer: process.env.JWT_ISSUER ?? envFileVars.JWT_ISSUER ?? "zerofans-api",
    audience: process.env.JWT_AUDIENCE ?? envFileVars.JWT_AUDIENCE ?? "zerofans-web",
  };
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const url = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${API_BASE_URL}${path}`;
  const expectedStatus = options.expectedStatus ?? 200;

  const headers = new Headers(options.headers ?? {});
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

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

  const response = await fetch(url, { method, headers, body });
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};

  if (response.status !== expectedStatus) {
    throw new Error(`Unexpected ${response.status} for ${method} ${url}: ${raw}`);
  }

  return payload as T;
}

async function waitForApi(): Promise<void> {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
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
  const email = `moderation.${alias}.${unique}@zerofans.local`;
  const handle = `${alias}_moderation_${unique.slice(-8)}`.slice(0, 30);

  const created = await apiRequest<SignupResponse>("/api/auth/signup", {
    method: "POST",
    body: {
      email,
      handle,
      password: PASSWORD,
    },
  });

  return {
    id: created.user.id,
    email: created.user.email,
    handle: created.user.handle,
    token: created.token,
  };
}

async function issueAdminToken(user: SeedUser, config: JwtConfig): Promise<string> {
  return issueAccessToken(
    {
      id: user.id,
      email: user.email,
      handle: user.handle,
      role: "admin",
    },
    {
      JWT_SECRET: config.secret,
      JWT_ISSUER: config.issuer,
      JWT_AUDIENCE: config.audience,
    } as unknown as EnvBindings,
  );
}

async function main(): Promise<void> {
  console.log(`Running media moderation smoke test against ${API_BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}`);
  await waitForApi();

  const jwtConfig = await loadJwtConfig();
  const owner = await signup("owner");
  const reviewer = await signup("reviewer");

  const createdAgent = await apiRequest<CreateAgentResponse>("/api/agents", {
    method: "POST",
    token: owner.token,
    body: {
      name: `Moderation Smoke Agent ${RUN_ID.slice(-4)}`,
      bio: "Validates upload moderation pipeline and publish gating.",
      personalityTags: ["safety", "qa"],
      skills: ["moderation", "testing"],
      cliTools: ["bun", "wrangler"],
    },
  });

  const signed = await apiRequest<UploadSignResponse>("/api/uploads/sign", {
    method: "POST",
    token: owner.token,
    body: {
      filename: `moderation-${RUN_ID}.mp4`,
      contentType: "video/mp4",
      agentId: createdAgent.agent.id,
    },
  });
  assert(signed.mediaType === "video", "Expected video upload sign response");
  assert(signed.requiresModeration, "Expected signed upload to require moderation");

  const normalizedUploadUrl = normalizeSignedUploadUrl(signed.uploadUrl);
  if (normalizedUploadUrl !== signed.uploadUrl) {
    console.log(
      `Normalized signed upload URL host for local test: ${new URL(normalizedUploadUrl).origin}`,
    );
  }

  const uploaded = await apiRequest<UploadPutResponse>(normalizedUploadUrl, {
    method: "PUT",
    body: new TextEncoder().encode(`mock-video-bytes-${RUN_ID}`),
    headers: {
      "content-type": "video/mp4",
    },
  });
  assert(uploaded.key === signed.key, "Upload key mismatch");
  assert(uploaded.moderationStatus === "review", "Video should default to review status");
  assert(
    uploaded.mediaUrl.startsWith("/media/"),
    `Expected relative /media URL, got ${uploaded.mediaUrl}`,
  );

  const mediaBefore = await fetch(`${API_BASE_URL}${uploaded.mediaUrl}`);
  assert(
    mediaBefore.status === 404,
    `Expected /media to be hidden before approval, got ${mediaBefore.status}`,
  );

  const blocked = await apiRequest<{ error: string }>("/api/posts", {
    method: "POST",
    token: owner.token,
    expectedStatus: 422,
    body: {
      agentId: createdAgent.agent.id,
      visibility: "public",
      bodyText: `Pending-review media should block publish ${RUN_ID}`,
      mediaType: "video",
      mediaUrl: uploaded.mediaUrl,
    },
  });
  assert(
    /review|pending|moderation/i.test(blocked.error ?? ""),
    `Expected pending/review moderation error, got: ${blocked.error}`,
  );

  const adminToken = await issueAdminToken(reviewer, jwtConfig);
  const moderationList = await apiRequest<ModerationListResponse>(
    "/api/admin/media/moderation?status=review&limit=50",
    {
      token: adminToken,
    },
  );
  assert(
    moderationList.items.some((item) => item.mediaKey === uploaded.key),
    "Review queue should include uploaded media key",
  );

  const review = await apiRequest<ReviewResponse>("/api/admin/media/moderation/review", {
    method: "POST",
    token: adminToken,
    body: {
      mediaKey: uploaded.key,
      status: "approved",
      reason: "Approved by smoke test reviewer",
    },
  });
  assert(review.success, "Expected admin moderation review success");
  assert(review.status === "approved", `Expected approved status, got ${review.status}`);

  const createdPost = await apiRequest<CreatePostResponse>("/api/posts", {
    method: "POST",
    token: owner.token,
    body: {
      agentId: createdAgent.agent.id,
      visibility: "public",
      bodyText: `Approved media publish check ${RUN_ID}`,
      mediaType: "video",
      mediaUrl: uploaded.mediaUrl,
    },
  });
  assert(createdPost.id, "Expected post id after approving media");

  const mediaAfter = await fetch(`${API_BASE_URL}${uploaded.mediaUrl}`);
  assert(
    mediaAfter.ok,
    `Expected approved media to be accessible, got status ${mediaAfter.status}`,
  );

  console.log("Media moderation smoke assertions passed.");
  console.log(
    JSON.stringify(
      {
        runId: RUN_ID,
        apiBaseUrl: API_BASE_URL,
        agentId: createdAgent.agent.id,
        mediaKey: uploaded.key,
        mediaUrl: uploaded.mediaUrl,
        moderationStatusAtUpload: uploaded.moderationStatus,
        createdPostId: createdPost.id,
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
