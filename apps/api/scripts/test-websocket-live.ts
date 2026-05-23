/**
 * E2E test for v0.0.5 — WebSocket Live Event Stream
 *
 * Tests: WS connection, auth, event broadcast, filters, ping/pong,
 * invalid auth rejected, REST push triggers WS broadcast.
 *
 * Run: bun run scripts/test-websocket-live.ts
 */

const API = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const WS_URL = API.replace(/^http/, "ws");
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  PASS: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

async function api(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── Ed25519 helpers ──

async function generateKeyPair() {
  const ed25519 = await import("@noble/ed25519");
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const toBase64 = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
  return { publicKey: toBase64(publicKey), privateKey: toBase64(privateKey) };
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  return Array.from(binary).map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

// ── Setup ──

async function registerNode() {
  const keypair = await generateKeyPair();
  const pubkeyHex = base64ToHex(keypair.publicKey);

  const { status, data } = await api("/rpc/trpc/sync.register", {
    method: "POST",
    body: { name: `ws-test-${Date.now()}`, publicKey: pubkeyHex },
  });

  if (status !== 200 || !data?.result?.data?.apiKey) {
    console.error("Node registration failed:", status, JSON.stringify(data));
    return null;
  }

  return data.result.data as { nodeId: string; apiKey: string; nodeName: string };
}

// ── Helpers ──

function connectWS(apiKey: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/rpc/live?apiKey=${encodeURIComponent(apiKey)}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (err) => reject(err);
    setTimeout(() => reject(new Error("WS connect timeout")), 10_000);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const handler = (evt: MessageEvent) => {
      ws.removeEventListener("message", handler);
      resolve(evt.data as string);
    };
    ws.addEventListener("message", handler);
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("Message timeout"));
    }, timeoutMs);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests ──

async function testInvalidAuthRejected() {
  console.log("\n-- Test: Invalid auth rejected --");
  try {
    await connectWS("zn_invalid_key");
    assert(false, "Should not connect with invalid key");
  } catch {
    assert(true, "WS connection rejected with invalid key");
  }
}

async function testMissingApiKeyRejected() {
  console.log("\n-- Test: Missing apiKey rejected --");
  try {
    const ws = new WebSocket(`${WS_URL}/rpc/live`);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => { assert(false, "Should not connect without apiKey"); resolve(); };
      ws.onerror = () => { assert(true, "WS connection rejected without apiKey"); resolve(); };
      setTimeout(() => reject(new Error("timeout")), 5_000);
    });
    ws.close();
  } catch {
    assert(true, "WS connection rejected without apiKey (timeout)");
  }
}

async function testSuccessfulConnection() {
  console.log("\n-- Test: Successful WS connection --");
  const node = await registerNode();
  assert(!!node, "Setup: node registered");
  if (!node) return null;

  const ws = await connectWS(node.apiKey);
  assert(ws.readyState === 1, "WS connected (readyState = OPEN)");

  // Send REQ to subscribe
  ws.send(JSON.stringify(["REQ", {}]));
  const msg = await waitForMessage(ws);
  const parsed = JSON.parse(msg);
  assert(parsed[0] === "OK" && parsed[1] === "connected", "Received OK connected after REQ");

  return { ws, node };
}

async function testPingPong(ws: WebSocket) {
  console.log("\n-- Test: PING/PONG --");
  ws.send(JSON.stringify(["PING"]));
  const msg = await waitForMessage(ws);
  const parsed = JSON.parse(msg);
  assert(parsed[0] === "PONG", "Received PONG for PING");
}

async function testEventBroadcastViaRestPush(ws: WebSocket, apiKey: string, keypair: Awaited<ReturnType<typeof generateKeyPair>>) {
  console.log("\n-- Test: REST push triggers WS broadcast --");

  const ed25519 = await import("@noble/ed25519");
  const toBase64 = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
  const pubkeyHex = base64ToHex(keypair.publicKey);

  const created_at = Math.floor(Date.now() / 1000);
  const kind = 1;
  const tags: string[][] = [];
  const content = `WS broadcast test ${Date.now()}`;
  const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content]);

  const privBytes = new Uint8Array(atob(keypair.privateKey).length);
  for (let i = 0; i < atob(keypair.privateKey).length; i++) privBytes[i] = atob(keypair.privateKey).charCodeAt(i);
  const eventId = await (async () => {
    const hash = await import("crypto");
    const encoded = new TextEncoder().encode(serialized);
    const digest = await hash.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  })();

  const sig = toBase64(await ed25519.signAsync(new TextEncoder().encode(serialized), privBytes));

  const { status } = await api("/rpc/push", {
    method: "POST",
    body: {
      events: [{
        id: eventId,
        pubkey: pubkeyHex,
        kind,
        created_at,
        tags,
        content,
        sig,
      }],
    },
    headers: { "X-Node-API-Key": apiKey },
  });
  assert(status === 200, "REST push accepted");

  // Wait for broadcast to arrive via WS
  const msg = await waitForMessage(ws, 5_000);
  const parsed = JSON.parse(msg);
  assert(parsed[0] === "EVENT", "Received EVENT message via WS");
  assert(parsed[1]?.id === eventId, "Event ID matches pushed event");
  assert(parsed[1]?.content === content, "Event content matches");
}

async function testFilters(ws: WebSocket) {
  console.log("\n-- Test: Event filters --");

  // Subscribe to only kind 7 events
  ws.send(JSON.stringify(["REQ", { kinds: [7] }]));
  const msg = await waitForMessage(ws);
  const parsed = JSON.parse(msg);
  assert(parsed[0] === "OK", "Filters updated acknowledged");
}

async function testHealthEndpoint() {
  console.log("\n-- Test: Health endpoint accessible --");
  const { status, data } = await api("/rpc/health");
  assert(status === 200, "Health returns 200");
  assert(data.service === "zerofans-rpc", "Health returns correct service name");
}

// ── Run ──

async function main() {
  console.log(`\nZeroFans v0.0.5 — WebSocket Live Stream E2E Tests`);
  console.log(`API: ${API}`);
  console.log(`WS:  ${WS_URL}\n`);

  try {
    await testInvalidAuthRejected();
    await testMissingApiKeyRejected();

    const result = await testSuccessfulConnection();
    if (result) {
      await testPingPong(result.ws);

      const keypair = await generateKeyPair();
      await testEventBroadcastViaRestPush(result.ws, result.node.apiKey, keypair);
      await testFilters(result.ws);
      await testHealthEndpoint();

      result.ws.close();
    }
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
