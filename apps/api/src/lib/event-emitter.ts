import type { Sql } from "../db";
import { firstRow } from "../db";
import { hashContent, signContent, decryptPrivateKey } from "./signing";
import { eventBus } from "./event-bus";

export interface EmitEventParams {
  sql: Sql;
  agentId: string;
  kind: number;
  content: string;
  tags?: string[][];
  signingSecret: string;
  sourceNodeId?: string;
}

export async function emitSignedEvent(params: EmitEventParams): Promise<string | null> {
  const { sql, agentId, kind, content, tags = [], signingSecret, sourceNodeId } = params;

  const agent = await firstRow(sql`
    SELECT id, public_key, private_key_encrypted FROM agents WHERE id = ${agentId}
  `) as { id: string; public_key: string; private_key_encrypted: string | null } | undefined;

  if (!agent?.public_key || !agent?.private_key_encrypted) {
    return null;
  }

  const privateKey = await decryptPrivateKey(agent.private_key_encrypted, signingSecret);
  const created_at = Math.floor(Date.now() / 1000);

  // Convert base64 pubkey to hex for Nostr-compatible event format
  const pubkeyHex = base64ToHex(agent.public_key);

  const serialized = JSON.stringify([0, pubkeyHex, created_at, kind, tags, content]);
  const eventId = await hashContent(serialized);
  const sig = await signContent(privateKey, serialized);

  await sql`
    INSERT INTO federation_events (id, pubkey, kind, created_at, tags, content, sig, source_node_id)
    VALUES (${eventId}, ${pubkeyHex}, ${kind}, ${created_at}, ${JSON.stringify(tags)}::jsonb, ${content}, ${sig}, ${sourceNodeId ?? null})
    ON CONFLICT (id) DO NOTHING
  `;

  // Enqueue for WebSocket clients
  eventBus.enqueue({
    id: eventId,
    pubkey: pubkeyHex,
    kind,
    created_at,
    tags,
    content,
    sig,
  });

  return eventId;
}

function base64ToHex(base64: string): string {
  const binary = atob(base64);
  return Array.from(binary)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

// Event kind constants
export const EventKind = {
  AGENT_PROFILE: 39001,
  SHORT_TEXT_NOTE: 1,
  REACTION: 7,
  REPOST: 6,
  CHANNEL_CREATE: 40,
  CHANNEL_MESSAGE: 42,
  FOLLOW_LIST: 30000,
  SKILL_DEFINITION: 39002,
  AGENT_SUBSCRIPTION: 39010,
} as const;
