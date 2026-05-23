import { Hono } from "hono";
import { upgradeWebSocket } from "hono/cloudflare-workers";
import { firstRow } from "../db";
import { verifySignature, hashContent } from "../lib/signing";
import { eventBus } from "../lib/event-bus";
import type { FederationEvent } from "../lib/event-bus";

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

// Auth middleware for WebSocket — validates apiKey before upgrade
rpcRoutes.use("/live", async (c, next) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (upgradeHeader !== "websocket") return next();

  const apiKey = new URL(c.req.url).searchParams.get("apiKey");
  if (!apiKey) {
    return c.json({ error: "apiKey query param required" }, 401);
  }

  const sql = c.get("sql");
  const apiKeyHash = await hashContent(apiKey);
  const node = await firstRow(
    sql`SELECT id FROM relay_nodes WHERE api_key_hash = ${apiKeyHash} AND status = 'active'`,
  );

  if (!node) {
    return c.json({ error: "Invalid node API key" }, 401);
  }

  return next();
});

// WebSocket upgrade endpoint for live event streaming
rpcRoutes.get(
  "/live",
  upgradeWebSocket(() => {
    let lastEventId: string | null = null;
    let filters: { kinds?: number[]; pubkeys?: string[] } | undefined;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let active = true;

    const poll = (ws: Parameters<NonNullable<import("hono/ws").WSEvents["onMessage"]>>[1]) => {
      if (!active || ws.readyState !== 1) return;
      const events = eventBus.getEventsSince(lastEventId);
      for (const event of events) {
        if (filters) {
          if (filters.kinds?.length && !filters.kinds.includes(event.kind)) continue;
          if (filters.pubkeys?.length && !filters.pubkeys.includes(event.pubkey)) continue;
        }
        ws.send(JSON.stringify(["EVENT", event]));
        lastEventId = event.id;
      }
    };

    return {
      onMessage(evt, ws) {
        try {
          const data = JSON.parse(evt.data as string);
          if (Array.isArray(data)) {
            const [type, payload] = data;
            if (type === "REQ") {
              filters = { kinds: payload?.kinds, pubkeys: payload?.pubkeys };

              // Initial REQ: send backfill + start polling
              if (!pollTimer) {
                poll(ws);
                pollTimer = setInterval(() => poll(ws), 1000);
              }

              ws.send(JSON.stringify(["OK", "connected"]));
            } else if (type === "PING") {
              ws.send(JSON.stringify(["PONG"]));
            }
          }
        } catch {
          ws.send(JSON.stringify(["ERROR", "invalid message"]));
        }
      },
      onClose() {
        active = false;
        if (pollTimer) clearInterval(pollTimer);
      },
      onError() {
        active = false;
        if (pollTimer) clearInterval(pollTimer);
      },
    };
  }),
);

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

    // Enqueue for WebSocket clients to pick up
    eventBus.enqueue({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at ?? Math.floor(Date.now() / 1000),
      tags: event.tags ?? [],
      content: event.content ?? "",
      sig: event.sig,
    });
  }

  await sql`
    UPDATE relay_nodes SET events_pushed = events_pushed + ${accepted.length} WHERE id = ${node.id}
  `;

  return c.json({ accepted, rejected, count: { accepted: accepted.length, rejected: rejected.length } });
});
