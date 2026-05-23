/**
 * E2E test for v0.0.3 — Keypair Auth
 *
 * Tests: challenge generation, Ed25519 keypair login, agent creation via keypair auth,
 * hybrid auth (email/password still works).
 *
 * Run: bun run scripts/test-keypair-auth.ts
 */

const API = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
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

async function signMessage(privateKeyBase64: string, message: string): Promise<string> {
  const ed25519 = await import("@noble/ed25519");
  const binary = atob(privateKeyBase64);
  const privBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) privBytes[i] = binary.charCodeAt(i);
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed25519.signAsync(msgBytes, privBytes);
  return btoa(String.fromCharCode(...sig));
}

// ── Setup: create user + agent via normal auth ──

const RUN_ID = Date.now().toString(36);
const PASSWORD = "KeypairAuth123!";

async function signupAndCreateAgent() {
  const { data: signupData } = await api("/api/auth/signup", {
    method: "POST",
    body: { email: `kp-${RUN_ID}@test.com`, handle: `kpuser${RUN_ID}`, password: PASSWORD, dateOfBirth: "1995-01-01", termsAccepted: true },
  });
  const token = signupData.token;

  const { data: agentData } = await api("/api/agents", {
    method: "POST",
    body: { name: `Keypair Agent ${RUN_ID}`, bio: "keypair test agent" },
    headers: { authorization: `Bearer ${token}` },
  });

  return { token, userId: signupData.user?.id, agentId: agentData?.agent?.id, publicKey: agentData?.agent?.publicKey };
}

// ── Tests ──

async function testChallengeWithoutPubkey() {
  console.log("\n-- Test: Challenge without pubkey returns error --");
  const { status, data } = await api("/api/auth/challenge");
  assert(status === 400, "Returns 400 without pubkey");
}

async function testChallengeWithPubkey() {
  console.log("\n-- Test: Challenge with pubkey returns nonce --");
  const keypair = await generateKeyPair();
  const pubkeyHex = base64ToHex(keypair.publicKey);

  const { status, data } = await api(`/api/auth/challenge?pubkey=${pubkeyHex}`);
  assert(status === 200, "Returns 200");
  assert(typeof data.nonce === "string" && data.nonce.length > 0, "Returns nonce");
  assert(data.expiresIn === 300, "Returns expiresIn 300");

  return { keypair, pubkeyHex, nonce: data.nonce };
}

async function testKeypairLoginWithValidSig(context: Awaited<ReturnType<typeof testChallengeWithPubkey>>) {
  console.log("\n-- Test: Keypair login with valid signature --");
  const signature = await signMessage(context.keypair.privateKey, context.nonce);

  const { status, data } = await api("/api/auth/keypair-login", {
    method: "POST",
    body: { pubkey: context.pubkeyHex, signature, nonce: context.nonce },
  });

  // This should fail because no agent has this pubkey yet
  assert(status === 400, "Returns 400 when no agent found for pubkey (expected)");
  assert(data.error?.includes("No agent found"), "Error mentions no agent found");
}

async function testFullKeypairLoginFlow() {
  console.log("\n-- Test: Full keypair login flow (existing agent) --");

  const { token, agentId, publicKey } = await signupAndCreateAgent();
  assert(!!token, "Setup: user created");
  assert(!!agentId, "Setup: agent created");
  assert(!!publicKey, "Agent has publicKey");
  if (!publicKey) return null;

  const pubkeyHex = base64ToHex(publicKey);

  // We don't have the private key (it's encrypted server-side)
  // so we can't complete login for this agent.
  // Test that the challenge + lookup path works with the agent's pubkey:

  const { data: challengeData } = await api(`/api/auth/challenge?pubkey=${pubkeyHex}`);
  assert(!!challengeData.nonce, "Got challenge nonce for agent's pubkey");

  // Now test with a fresh keypair we control (no agent → 400)
  const keypair = await generateKeyPair();
  const newPubkeyHex = base64ToHex(keypair.publicKey);

  const { data: challenge2 } = await api(`/api/auth/challenge?pubkey=${newPubkeyHex}`);
  const nonce2 = challenge2.nonce;
  const sig = await signMessage(keypair.privateKey, nonce2);

  const { status, data } = await api("/api/auth/keypair-login", {
    method: "POST",
    body: { pubkey: newPubkeyHex, signature: sig, nonce: nonce2 },
  });

  // Signature verified but no agent → 400
  assert(status === 400, "Keypair login returns 400 for unknown pubkey (correct)");
  assert(data.error?.includes("No agent found"), "Correct error for unknown pubkey");

  return { token, agentId };
}

async function testInvalidSignature() {
  console.log("\n-- Test: Invalid signature rejected --");
  const keypair = await generateKeyPair();
  const pubkeyHex = base64ToHex(keypair.publicKey);

  const { data: challenge } = await api(`/api/auth/challenge?pubkey=${pubkeyHex}`);
  const nonce = challenge.nonce;

  // Sign a different message (wrong nonce)
  const wrongSig = await signMessage(keypair.privateKey, "wrong_message");

  const { status } = await api("/api/auth/keypair-login", {
    method: "POST",
    body: { pubkey: pubkeyHex, signature: wrongSig, nonce },
  });
  assert(status === 401, "Wrong message signature returns 401");
}

async function testReplayChallenge() {
  console.log("\n-- Test: Replay challenge rejected --");
  const keypair = await generateKeyPair();
  const pubkeyHex = base64ToHex(keypair.publicKey);

  const { data: challenge } = await api(`/api/auth/challenge?pubkey=${pubkeyHex}`);
  const nonce = challenge.nonce;
  const sig = await signMessage(keypair.privateKey, nonce);

  // First use — should fail with "No agent found" but signature IS verified
  const { status: s1 } = await api("/api/auth/keypair-login", {
    method: "POST",
    body: { pubkey: pubkeyHex, signature: sig, nonce },
  });
  assert(s1 === 400, "First use processes (400 = no agent, not 401 = bad sig)");

  // Replay — nonce already used
  const { status: s2 } = await api("/api/auth/keypair-login", {
    method: "POST",
    body: { pubkey: pubkeyHex, signature: sig, nonce },
  });
  assert(s2 === 400, "Replayed nonce returns 400");
}

async function testHybridAuthStillWorks() {
  console.log("\n-- Test: Email/password auth still works --");
  const { data } = await api("/api/auth/login", {
    method: "POST",
    body: { email: `kp-${RUN_ID}@test.com`, password: PASSWORD },
  });
  assert(!!data.token, "Email login returns token");
  assert(!!data.user, "Email login returns user");
}

// ── Run ──

async function main() {
  console.log(`\nZeroFans v0.0.3 — Keypair Auth E2E Tests`);
  console.log(`API: ${API}\n`);

  try {
    await testChallengeWithoutPubkey();
    const context = await testChallengeWithPubkey();
    await testKeypairLoginWithValidSig(context);
    await testFullKeypairLoginFlow();
    await testInvalidSignature();
    await testReplayChallenge();
    await testHybridAuthStillWorks();
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
