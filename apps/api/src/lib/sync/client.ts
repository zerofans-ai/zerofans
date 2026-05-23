import type { AppRouter } from "../../trpc/root-router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { verifySignature, hashContent } from "../signing";
import type { Sql } from "../../db";

export interface SyncClientConfig {
  relayUrl: string;
  apiKey: string;
  nodeId: string;
  sql: Sql;
  syncIntervalMs?: number;
  useWebSocket?: boolean;
  onEventReceived?: (event: FederationEvent) => void | Promise<void>;
}

export interface FederationEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export class SyncClient {
  private config: Required<Pick<SyncClientConfig, "relayUrl" | "apiKey" | "nodeId" | "sql" | "syncIntervalMs" | "useWebSocket">> & {
    onEventReceived?: (event: FederationEvent) => void | Promise<void>;
  };
  private trpcClient: ReturnType<typeof createTRPCClient<AppRouter>>;
  private cursor: string | null = null;
  private running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SyncClientConfig) {
    this.config = {
      relayUrl: config.relayUrl,
      apiKey: config.apiKey,
      nodeId: config.nodeId,
      sql: config.sql,
      syncIntervalMs: config.syncIntervalMs ?? 30_000,
      useWebSocket: config.useWebSocket ?? false,
      onEventReceived: config.onEventReceived,
    };

    this.trpcClient = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${config.relayUrl}/rpc`,
          headers: () => ({}),
        }),
      ],
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Load last cursor from local DB
    const { firstRow } = await import("../../db");
    const row = await firstRow(
      this.config.sql`SELECT cursor FROM rpc_sync_cursors WHERE node_id = ${this.config.nodeId} AND stream = 'local'`,
    ) as { cursor: string } | undefined;
    this.cursor = row?.cursor ?? null;

    if (this.config.useWebSocket) {
      this.connectWebSocket();
    }

    // Initial sync + periodic polling (always runs as fallback)
    await this.sync();
    this.intervalId = setInterval(() => this.sync(), this.config.syncIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connectWebSocket(): void {
    const wsUrl = this.config.relayUrl.replace(/^http/, "ws");
    const url = `${wsUrl}/rpc/live?apiKey=${encodeURIComponent(this.config.apiKey)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      console.error("[SyncClient] WebSocket constructor failed");
      this.scheduleWsReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[SyncClient] WebSocket connected");
      // Send REQ to subscribe (empty filters = all events)
      this.ws?.send(JSON.stringify(["REQ", {}]));
    };

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data as string);
        if (Array.isArray(data) && data[0] === "EVENT" && data[1]) {
          const event = data[1] as FederationEvent;
          if (this.config.onEventReceived) {
            this.config.onEventReceived(event);
          }
        }
      } catch {
        // Ignore non-JSON or control messages
      }
    };

    this.ws.onclose = () => {
      console.log("[SyncClient] WebSocket closed");
      this.ws = null;
      if (this.running) this.scheduleWsReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("[SyncClient] WebSocket error:", err);
    };
  }

  private scheduleWsReconnect(): void {
    if (this.wsReconnectTimer) return;
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      if (this.running) this.connectWebSocket();
    }, 5_000);
  }

  async pushEvents(events: FederationEvent[]): Promise<{ accepted: number }> {
    try {
      const result = await this.trpcClient.sync.sync.mutate({
        nodeApiKey: this.config.apiKey,
        cursor: this.cursor,
        push: events,
        limit: 1,
      });
      return { accepted: result.accepted };
    } catch (err) {
      console.error("[SyncClient] push error:", err);
      return { accepted: 0 };
    }
  }

  private async sync(): Promise<void> {
    try {
      // Gather local events to push
      const localEvents = await this.getLocalEvents();

      const result = await this.trpcClient.sync.sync.mutate({
        nodeApiKey: this.config.apiKey,
        cursor: this.cursor,
        push: localEvents,
        limit: 500,
      });

      // Process received events
      for (const event of result.events) {
        // Store locally
        await this.config.sql`
          INSERT INTO federation_events (id, pubkey, kind, created_at, tags, content, sig)
          VALUES (${event.id}, ${event.pubkey}, ${event.kind}, ${event.created_at}, ${JSON.stringify(event.tags)}::jsonb, ${event.content}, ${event.sig})
          ON CONFLICT (id) DO NOTHING
        `;

        if (this.config.onEventReceived) {
          await this.config.onEventReceived(event);
        }
      }

      // Update cursor
      if (result.cursor) {
        this.cursor = result.cursor;
        await this.config.sql`
          INSERT INTO rpc_sync_cursors (node_id, stream, cursor)
          VALUES (${this.config.nodeId}, 'local', ${this.cursor})
          ON CONFLICT (node_id, stream) DO UPDATE SET cursor = ${this.cursor}, updated_at = now()
        `;
      }
    } catch (err) {
      console.error("[SyncClient] sync error:", err);
    }
  }

  private async getLocalEvents(): Promise<FederationEvent[]> {
    const events = (await this.config.sql`
      SELECT id, pubkey, kind, created_at, tags, content, sig
      FROM federation_events
      WHERE source_node_id IS NULL
      ORDER BY received_at DESC
      LIMIT 500
    `) as Array<{
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      tags: unknown;
      content: string;
      sig: string;
    }>;

    return events.map((e) => ({
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      created_at: e.created_at,
      tags: typeof e.tags === "string" ? JSON.parse(e.tags) : (e.tags as string[][]),
      content: e.content,
      sig: e.sig,
    }));
  }
}
