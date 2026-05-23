import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { firstRow } from "../../db";
import { hashContent, verifySignature } from "../../lib/signing";

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  return btoa(String.fromCharCode(...bytes));
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  return Array.from(binary)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

const eventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  kind: z.number().int(),
  created_at: z.number().int(),
  tags: z.array(z.array(z.string())).default([]),
  content: z.string().default(""),
  sig: z.string(),
});

const nodeAuthInputSchema = z.object({
  nodeApiKey: z.string(),
});

const nodeAuthMiddleware = publicProcedure
  .input(nodeAuthInputSchema)
  .use(async (opts) => {
    const nodeApiKey = opts.input.nodeApiKey;
    if (!nodeApiKey) {
      throw new Error("Node API key required");
    }

    const apiKeyHash = await hashContent(nodeApiKey);

    const node = await firstRow(
      opts.ctx.sql`SELECT id, name, public_key, capabilities, status FROM relay_nodes WHERE api_key_hash = ${apiKeyHash} AND status = 'active'`,
    ) as { id: string; name: string; public_key: string; capabilities: string[]; status: string } | undefined;

    if (!node) {
      throw new Error("Invalid or inactive node API key");
    }

    return opts.next({
      ctx: {
        ...opts.ctx,
        node: {
          id: node.id,
          name: node.name,
          publicKey: node.public_key,
          capabilities:
            typeof node.capabilities === "string"
              ? JSON.parse(node.capabilities)
              : node.capabilities ?? [],
        },
      },
    });
  });

async function computeEventId(event: z.infer<typeof eventSchema>): Promise<string> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return hashContent(serialized);
}

function serializeEvent(event: z.infer<typeof eventSchema>): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

export const syncRouter = router({
  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        publicKey: z.string().min(1),
        callbackUrl: z.string().url().optional(),
        capabilities: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const apiKey = `zn_${crypto.randomUUID().replace(/-/g, "")}`;
      const apiKeyHash = await hashContent(apiKey);

      const node = await firstRow(
        ctx.sql`
          INSERT INTO relay_nodes (name, public_key, api_key_hash, callback_url, capabilities)
          VALUES (${input.name}, ${input.publicKey}, ${apiKeyHash}, ${input.callbackUrl ?? null}, ${JSON.stringify(input.capabilities)}::jsonb)
          ON CONFLICT (public_key) DO UPDATE SET
            name = EXCLUDED.name,
            callback_url = EXCLUDED.callback_url,
            capabilities = EXCLUDED.capabilities,
            status = 'active'
          RETURNING id, name
        `,
      ) as { id: string; name: string } | undefined;

      if (!node) {
        throw new Error("Failed to register node");
      }

      await ctx.sql`
        INSERT INTO rpc_sync_cursors (node_id, stream, cursor)
        VALUES (${node.id}, 'global', '0')
        ON CONFLICT (node_id, stream) DO NOTHING
      `;

      return {
        nodeId: node.id,
        nodeName: node.name,
        apiKey,
      };
    }),

  sync: nodeAuthMiddleware
    .input(
      z.object({
        nodeApiKey: z.string(),
        cursor: z.string().nullable(),
        push: z.array(eventSchema).max(500).default([]),
        limit: z.number().int().min(1).max(1000).default(500),
        filters: z
          .object({
            kinds: z.array(z.number().int()).optional(),
            pubkeys: z.array(z.string()).optional(),
            since: z.number().int().optional(),
            until: z.number().int().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const nodeId = ctx.node.id;
      const limit = input.limit;

      // Resolve cursor
      let cursor: string;
      if (input.cursor) {
        cursor = input.cursor;
      } else {
        const cursorRow = await firstRow(
          ctx.sql`SELECT cursor FROM rpc_sync_cursors WHERE node_id = ${nodeId} AND stream = 'global'`,
        ) as { cursor: string } | undefined;
        cursor = cursorRow?.cursor ?? "0";
      }

      // Validate and store pushed events
      let accepted = 0;
      for (const event of input.push) {
        const computedId = await computeEventId(event);
        if (computedId !== event.id) {
          continue;
        }

        const serialized = serializeEvent(event);
        const sigValid = await verifySignature(hexToBase64(event.pubkey), event.sig, serialized);
        if (!sigValid) {
          continue;
        }

        await ctx.sql`
          INSERT INTO federation_events (id, pubkey, kind, created_at, tags, content, sig, source_node_id)
          VALUES (${event.id}, ${event.pubkey}, ${event.kind}, ${event.created_at}, ${JSON.stringify(event.tags)}::jsonb, ${event.content}, ${event.sig}, ${nodeId})
          ON CONFLICT (id) DO NOTHING
        `;
        accepted++;
      }

      // Pull events since cursor
      const cursorTime = await firstRow(
        ctx.sql`SELECT received_at FROM federation_events WHERE id = ${cursor}`,
      ) as { received_at: string } | undefined;

      const sinceTime = cursorTime?.received_at ?? "1970-01-01T00:00:00Z";
      const kinds = input.filters?.kinds;
      const pubkeys = input.filters?.pubkeys;
      const since = input.filters?.since;
      const until = input.filters?.until;

      let events: Array<{
        id: string;
        pubkey: string;
        kind: number;
        created_at: number;
        tags: string;
        content: string;
        sig: string;
      }>;

      if (kinds && kinds.length > 0 && pubkeys && pubkeys.length > 0) {
        events = (await ctx.sql`
          SELECT id, pubkey, kind, created_at, tags, content, sig
          FROM federation_events
          WHERE received_at > ${sinceTime}::timestamptz
            AND kind = ANY(${kinds}::int[])
            AND pubkey = ANY(${pubkeys}::text[])
            AND (${since ?? null}::bigint IS NULL OR created_at >= ${since ?? null}::bigint)
            AND (${until ?? null}::bigint IS NULL OR created_at <= ${until ?? null}::bigint)
          ORDER BY received_at ASC
          LIMIT ${limit}
        `) as typeof events;
      } else if (kinds && kinds.length > 0) {
        events = (await ctx.sql`
          SELECT id, pubkey, kind, created_at, tags, content, sig
          FROM federation_events
          WHERE received_at > ${sinceTime}::timestamptz
            AND kind = ANY(${kinds}::int[])
            AND (${since ?? null}::bigint IS NULL OR created_at >= ${since ?? null}::bigint)
            AND (${until ?? null}::bigint IS NULL OR created_at <= ${until ?? null}::bigint)
          ORDER BY received_at ASC
          LIMIT ${limit}
        `) as typeof events;
      } else if (pubkeys && pubkeys.length > 0) {
        events = (await ctx.sql`
          SELECT id, pubkey, kind, created_at, tags, content, sig
          FROM federation_events
          WHERE received_at > ${sinceTime}::timestamptz
            AND pubkey = ANY(${pubkeys}::text[])
            AND (${since ?? null}::bigint IS NULL OR created_at >= ${since ?? null}::bigint)
            AND (${until ?? null}::bigint IS NULL OR created_at <= ${until ?? null}::bigint)
          ORDER BY received_at ASC
          LIMIT ${limit}
        `) as typeof events;
      } else {
        events = (await ctx.sql`
          SELECT id, pubkey, kind, created_at, tags, content, sig
          FROM federation_events
          WHERE received_at > ${sinceTime}::timestamptz
            AND (${since ?? null}::bigint IS NULL OR created_at >= ${since ?? null}::bigint)
            AND (${until ?? null}::bigint IS NULL OR created_at <= ${until ?? null}::bigint)
          ORDER BY received_at ASC
          LIMIT ${limit}
        `) as typeof events;
      }

      const lastEvent = events.length > 0 ? events[events.length - 1] : null;
      const newCursor = lastEvent ? lastEvent.id : cursor;

      // Update sync cursor and stats
      await ctx.sql`
        INSERT INTO rpc_sync_cursors (node_id, stream, cursor)
        VALUES (${nodeId}, 'global', ${newCursor})
        ON CONFLICT (node_id, stream) DO UPDATE SET cursor = ${newCursor}, updated_at = now()
      `;

      await ctx.sql`
        UPDATE relay_nodes SET
          last_sync_at = now(),
          events_pushed = events_pushed + ${accepted},
          events_pulled = events_pulled + ${events.length}
        WHERE id = ${nodeId}
      `;

      return {
        events: events.map((e) => ({
          id: e.id,
          pubkey: e.pubkey,
          kind: e.kind,
          created_at: e.created_at,
          tags: typeof e.tags === "string" ? JSON.parse(e.tags) : e.tags,
          content: e.content,
          sig: e.sig,
        })),
        cursor: newCursor,
        accepted,
      };
    }),

  peers: nodeAuthMiddleware
    .input(
      z.object({
        nodeApiKey: z.string(),
      }),
    )
    .mutation(async ({ ctx }) => {
      const peers = (await ctx.sql`
        SELECT id, name, public_key, capabilities, callback_url, last_sync_at, status
        FROM relay_nodes
        WHERE status = 'active' AND id != ${ctx.node.id}
        ORDER BY last_sync_at DESC NULLS LAST
        LIMIT 50
      `) as Array<{
        id: string;
        name: string;
        public_key: string;
        capabilities: string;
        callback_url: string | null;
        last_sync_at: string | null;
        status: string;
      }>;

      return {
        peers: peers.map((p) => ({
          id: p.id,
          name: p.name,
          publicKey: p.public_key,
          capabilities:
            typeof p.capabilities === "string"
              ? JSON.parse(p.capabilities)
              : p.capabilities ?? [],
          callbackUrl: p.callback_url,
          lastSyncAt: p.last_sync_at,
        })),
      };
    }),

  verify: publicProcedure
    .input(
      z.object({
        eventId: z.string(),
        pubkey: z.string(),
        sig: z.string(),
        serialized: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const event = await firstRow(
        ctx.sql`SELECT id FROM federation_events WHERE id = ${input.eventId}`,
      );

      const sigValid = await verifySignature(
        hexToBase64(input.pubkey),
        input.sig,
        input.serialized,
      );

      return {
        exists: !!event,
        valid: sigValid,
      };
    }),
});
