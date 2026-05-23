import { Hono } from "hono";
import { firstRow } from "../db";
import { verifySignature, hashContent } from "../lib/signing";

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  return btoa(String.fromCharCode(...bytes));
}
import type { AppEnv } from "../types/env";

export const rpcRoutes = new Hono<AppEnv>();

// Health check for RPC layer
rpcRoutes.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "zerofans-rpc",
    timestamp: new Date().toISOString(),
  });
});

// WebSocket upgrade endpoint for live event streaming
rpcRoutes.get("/live", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") {
    return c.json({ info: "WebSocket endpoint for live event streaming. Connect with a WebSocket client." }, 200);
  }
  return c.json({ error: "Use WebSocket client to connect" }, 426);
});

// REST bridge for push (for nodes without tRPC client)
rpcRoutes.post("/push", async (c) => {
  let apiKey = c.req.header("X-Node-API-Key");
  if (!apiKey) {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      apiKey = authHeader.slice(7);
    }
  }
  if (!apiKey) {
    return c.json({ error: "X-Node-API-Key or Authorization header required" }, 401);
  }

  const sql = c.get("sql");

  const apiKeyHash = await hashContent(apiKey);
  const node = await firstRow(
    sql`SELECT id, name, public_key, capabilities FROM relay_nodes WHERE api_key_hash = ${apiKeyHash} AND status = 'active'`,
  ) as { id: string; name: string; public_key: string; capabilities: unknown } | undefined;

  if (!node) {
    return c.json({ error: "Invalid node API key" }, 401);
  }

  const body = await c.req.json();
  const events = Array.isArray(body?.events) ? body.events : [];
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const event of events) {
    if (!event.id || !event.pubkey || !event.sig || typeof event.kind !== "number") {
      rejected.push(event.id ?? "unknown");
      continue;
    }

    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags ?? [],
      event.content ?? "",
    ]);

    const sigValid = await verifySignature(hexToBase64(event.pubkey), event.sig, serialized);
    if (!sigValid) {
      rejected.push(event.id);
      continue;
    }

    await sql`
      INSERT INTO federation_events (id, pubkey, kind, created_at, tags, content, sig, source_node_id)
      VALUES (${event.id}, ${event.pubkey}, ${event.kind}, ${event.created_at ?? Math.floor(Date.now() / 1000)}, ${JSON.stringify(event.tags ?? [])}::jsonb, ${event.content ?? ""}, ${event.sig}, ${node.id})
      ON CONFLICT (id) DO NOTHING
    `;
    accepted.push(event.id);
  }

  await sql`
    UPDATE relay_nodes SET events_pushed = events_pushed + ${accepted.length} WHERE id = ${node.id}
  `;

  return c.json({ accepted, rejected, count: { accepted: accepted.length, rejected: rejected.length } });
});
