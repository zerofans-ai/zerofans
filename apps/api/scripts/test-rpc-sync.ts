/**
 * End-to-end test for the tRPC sync / RPC layer.
 *
 * Tests: node registration, event sync (push/pull), peer discovery,
 * signature verification, REST push bridge.
 *
 * Run: bun run scripts/test-rpc-sync.ts
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

// ── Helpers: generate Ed25519 keypair + sign events ──

async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const ed25519 = await import("@noble/ed25519");
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const toBase64 = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
  return {
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signContent(privateKeyBase64: string, content: string): Promise<string> {
  const ed25519 = await import("@noble/ed25519");
  const binary = atob(privateKeyBase64);
  const privBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) privBytes[i] = binary.charCodeAt(i);
  const message = new TextEncoder().encode(content);
  const signature = await ed25519.signAsync(message, privBytes);
  return btoa(String.fromCharCode(...signature));
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  return Array.from(binary)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

async function buildSignedEvent(params: {
  pubkey: string;
  kind: number;
  content: string;
  tags?: string[][];
  privateKey: string;
}) {
  const created_at = Math.floor(Date.now() / 1000);
  const tags = params.tags ?? [];
  const serialized = JSON.stringify([0, params.pubkey, created_at, params.kind, tags, params.content]);
  const id = await hashContent(serialized);
  const sig = await signContent(params.privateKey, serialized);
  return { id, pubkey: params.pubkey, kind: params.kind, created_at, tags, content: params.content, sig };
}

// ── tRPC HTTP batch call helper ──

async function trpcCall(procedure: string, input: unknown) {
  const res = await fetch(`${API}/rpc/trpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.result?.data) return { ok: true, data: json.result.data };
    if (json.error) return { ok: false, error: json.error };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: text };
  }
}

// ── Tests ──

async function testHealthCheck() {
  console.log("\n── Test: RPC Health Check ──");
  const { status, data } = await api("/rpc/health");
  assert(status === 200, "RPC health endpoint returns 200");
  assert(data.status === "ok", "RPC health returns status ok");
  assert(data.service === "zerofans-rpc", "RPC health returns correct service name");
}

async function testNodeRegistration() {
  console.log("\n── Test: Node Registration ──");
  const keypair = await generateKeyPair();

  const result = await trpcCall("sync.register", {
    name: `test-node-${Date.now()}`,
    publicKey: base64ToHex(keypair.publicKey),
    capabilities: ["sync", "push"],
  });

  assert(result.ok, "Registration succeeds");
  if (!result.ok) {
    console.error("  Registration error:", result.error);
    return null;
  }

  const reg = result.data as { nodeId: string; nodeName: string; apiKey: string };
  assert(typeof reg.nodeId === "string" && reg.nodeId.length > 0, "Returns nodeId");
  assert(typeof reg.apiKey === "string" && reg.apiKey.startsWith("zn_"), "Returns API key with zn_ prefix");
  assert(typeof reg.nodeName === "string", "Returns nodeName");

  return { ...reg, keypair };
}

async function testSyncWithAuth(reg: NonNullable<Awaited<ReturnType<typeof testNodeRegistration>>>) {
  console.log("\n── Test: Sync with Authentication ──");

  // Build a signed event
  const pubkeyHex = base64ToHex(reg.keypair.publicKey);
  const event = await buildSignedEvent({
    pubkey: pubkeyHex,
    kind: 1,
    content: "Hello from test node!",
    privateKey: reg.keypair.privateKey,
  });

  // Sync: push event and pull
  const result = await trpcCall("sync.sync", {
    nodeApiKey: reg.apiKey,
    cursor: null,
    push: [event],
    limit: 100,
  });

  assert(result.ok, "Sync call succeeds");
  if (!result.ok) {
    console.error("  Sync error:", result.error);
    return;
  }

  const sync = result.data as { events: unknown[]; cursor: string; accepted: number };
  assert(typeof sync.cursor === "string", "Returns cursor");
  assert(typeof sync.accepted === "number", "Returns accepted count");
  assert(sync.accepted >= 0, "Accepted is non-negative");
}

async function testSyncWithInvalidKey() {
  console.log("\n── Test: Sync with Invalid API Key ──");
  const result = await trpcCall("sync.sync", {
    nodeApiKey: "zn_invalid_key_12345",
    cursor: null,
    push: [],
    limit: 10,
  });
  assert(!result.ok, "Sync fails with invalid key");
}

async function testPeers(reg: NonNullable<Awaited<ReturnType<typeof testNodeRegistration>>>) {
  console.log("\n── Test: Peer Discovery ──");
  const result = await trpcCall("sync.peers", {
    nodeApiKey: reg.apiKey,
  });

  assert(result.ok, "Peers call succeeds");
  if (!result.ok) {
    console.error("  Peers error:", result.error);
    return;
  }

  const peers = result.data as { peers: unknown[] };
  assert(Array.isArray(peers.peers), "Returns peers array");
}

async function testVerify(reg: NonNullable<Awaited<ReturnType<typeof testNodeRegistration>>>) {
  console.log("\n── Test: Signature Verification ──");

  const pubkeyHex = base64ToHex(reg.keypair.publicKey);
  const event = await buildSignedEvent({
    pubkey: pubkeyHex,
    kind: 1,
    content: "Verify this event",
    privateKey: reg.keypair.privateKey,
  });

  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);

  const result = await trpcCall("sync.verify", {
    eventId: event.id,
    pubkey: event.pubkey,
    sig: event.sig,
    serialized,
  });

  assert(result.ok, "Verify call succeeds");
  if (!result.ok) {
    console.error("  Verify error:", result.error);
    return;
  }

  const verify = result.data as { exists: boolean; valid: boolean };
  assert(verify.valid === true, "Signature is valid");
}

async function testRestPush(reg: NonNullable<Awaited<ReturnType<typeof testNodeRegistration>>>) {
  console.log("\n── Test: REST Push Bridge ──");

  const pubkeyHex = base64ToHex(reg.keypair.publicKey);
  const event = await buildSignedEvent({
    pubkey: pubkeyHex,
    kind: 1,
    content: "Pushed via REST",
    tags: [["t", "test"]],
    privateKey: reg.keypair.privateKey,
  });

  const { status, data } = await api("/rpc/push", {
    method: "POST",
    body: { events: [event] },
    headers: { "X-Node-API-Key": reg.apiKey },
  });

  assert(status === 200, `REST push returns 200 (got ${status})`);
  if (status === 200) {
    const push = data as { accepted: string[]; rejected: string[]; count: { accepted: number; rejected: number } };
    assert(push.count.accepted >= 0, "Returns accepted count");
    assert(Array.isArray(push.accepted), "Returns accepted array");
  }
}

async function testRestPushInvalidAuth() {
  console.log("\n── Test: REST Push Invalid Auth ──");
  const { status } = await api("/rpc/push", {
    method: "POST",
    body: { events: [] },
  });
  assert(status === 401, "REST push without auth returns 401");
}

async function testSyncFilters(reg: NonNullable<Awaited<ReturnType<typeof testNodeRegistration>>>) {
  console.log("\n── Test: Sync with Filters ──");

  const result = await trpcCall("sync.sync", {
    nodeApiKey: reg.apiKey,
    cursor: null,
    push: [],
    limit: 10,
    filters: {
      kinds: [1],
      since: Math.floor(Date.now() / 1000) - 3600,
    },
  });

  assert(result.ok, "Filtered sync succeeds");
  if (result.ok) {
    const sync = result.data as { events: unknown[]; cursor: string };
    assert(Array.isArray(sync.events), "Returns events array");
    assert(typeof sync.cursor === "string", "Returns cursor");
  }
}

// ── Run all tests ──

async function main() {
  console.log(`\nZeroFans tRPC Sync — E2E Tests`);
  console.log(`API: ${API}\n`);

  try {
    await testHealthCheck();

    const reg = await testNodeRegistration();
    if (!reg) {
      console.error("\nCannot continue — registration failed");
      process.exit(1);
    }

    await testSyncWithAuth(reg);
    await testSyncWithInvalidKey();
    await testPeers(reg);
    await testVerify(reg);
    await testRestPush(reg);
    await testRestPushInvalidAuth();
    await testSyncFilters(reg);
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
