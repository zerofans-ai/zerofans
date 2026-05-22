import { Hono } from "hono";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/http";
import { firstRow } from "../db";
import type { Sql } from "../db";
import { hashContent, signContent, decryptPrivateKey } from "../lib/signing";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types/env";

const startConversationSchema = z.object({
  agentId: z.string().uuid(),
  targetAgentId: z.string().uuid(),
});

const sendMessageSchema = z.object({
  agentId: z.string().uuid(),
  bodyText: z.string().min(1).max(5000),
});

async function ensureOwnedAgent(
  sql: Sql,
  agentId: string,
  userId: string,
): Promise<{ owner_user_id: string; slug: string } | null> {
  const row = await firstRow(sql`
    SELECT owner_user_id, slug FROM agents WHERE id = ${agentId}
  `);
  if (!row) return null;
  if (row.owner_user_id !== userId) return null;
  return row as { owner_user_id: string; slug: string };
}

function orderedParticipants(id1: string, id2: string): [string, string] {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

export const messagesRoutes = new Hono<AppEnv>();

// Start or get a conversation
messagesRoutes.post("/conversations", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = startConversationSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid payload");

  const { agentId, targetAgentId } = parsed.data;
  if (agentId === targetAgentId) return badRequest(c, "Cannot start conversation with yourself");

  const sql = c.get("sql");

  const agent = await ensureOwnedAgent(sql, agentId, authUser.id);
  if (!agent) return forbidden(c, "Not your agent");

  const target = await firstRow(sql`
    SELECT id FROM agents WHERE id = ${targetAgentId}
  `);
  if (!target) return notFound(c, "Target agent not found");

  const [p1, p2] = orderedParticipants(agentId, targetAgentId);

  const existing = await firstRow(sql`
    SELECT id FROM agent_conversations
    WHERE participant_1_agent_id = ${p1} AND participant_2_agent_id = ${p2}
  `);

  if (existing) {
    return c.json({ conversationId: existing.id });
  }

  const conversationId = crypto.randomUUID();
  await sql`
    INSERT INTO agent_conversations (id, participant_1_agent_id, participant_2_agent_id)
    VALUES (${conversationId}, ${p1}, ${p2})
  `;

  return c.json({ conversationId }, 201);
});

// List conversations for user's agents
messagesRoutes.get("/conversations", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const sql = c.get("sql");

  const userAgents = await sql`
    SELECT id FROM agents WHERE owner_user_id = ${authUser.id}
  `;
  const agentIds = userAgents.map((a: { id: string }) => a.id);

  if (agentIds.length === 0) return c.json({ conversations: [] });

  const conversations = await sql`
    SELECT
      c.id,
      c.participant_1_agent_id,
      c.participant_2_agent_id,
      c.updated_at,
      a1.name as p1_name,
      a1.slug as p1_slug,
      a1.avatar_url as p1_avatar,
      a2.name as p2_name,
      a2.slug as p2_slug,
      a2.avatar_url as p2_avatar,
      (SELECT body_text FROM agent_messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM agent_messages WHERE conversation_id = c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) as last_message_at,
      (SELECT COUNT(*)::int FROM agent_messages WHERE conversation_id = c.id AND sender_agent_id != ANY(${agentIds}) AND deleted_at IS NULL AND created_at > COALESCE(
        (SELECT MAX(m2.created_at) FROM agent_messages m2 WHERE m2.conversation_id = c.id AND m2.sender_agent_id = ANY(${agentIds})),
        '1970-01-01'::timestamptz
      )) as unread_count
    FROM agent_conversations c
    JOIN agents a1 ON a1.id = c.participant_1_agent_id
    JOIN agents a2 ON a2.id = c.participant_2_agent_id
    WHERE c.participant_1_agent_id = ANY(${agentIds}) OR c.participant_2_agent_id = ANY(${agentIds})
    ORDER BY c.updated_at DESC
  `;

  return c.json({ conversations });
});

// Get messages in a conversation
messagesRoutes.get("/conversations/:id", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const conversationId = c.req.param("id");
  const before = c.req.query("before");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);

  const sql = c.get("sql");

  const conv = await firstRow(sql`
    SELECT participant_1_agent_id, participant_2_agent_id
    FROM agent_conversations WHERE id = ${conversationId}
  `);
  if (!conv) return notFound(c, "Conversation not found");

  const userAgents = await sql`
    SELECT id FROM agents WHERE owner_user_id = ${authUser.id}
  `;
  const agentIds = userAgents.map((a: { id: string }) => a.id);

  const isParticipant =
    agentIds.includes(conv.participant_1_agent_id) ||
    agentIds.includes(conv.participant_2_agent_id);
  if (!isParticipant) return forbidden(c, "Not a participant");

  let messages;
  if (before) {
    messages = await sql`
      SELECT m.id, m.sender_agent_id, m.body_text, m.content_hash, m.signature, m.created_at,
             a.name as sender_name, a.slug as sender_slug, a.avatar_url as sender_avatar
      FROM agent_messages m
      JOIN agents a ON a.id = m.sender_agent_id
      WHERE m.conversation_id = ${conversationId} AND m.deleted_at IS NULL AND m.created_at < ${before}
      ORDER BY m.created_at DESC LIMIT ${limit}
    `;
  } else {
    messages = await sql`
      SELECT m.id, m.sender_agent_id, m.body_text, m.content_hash, m.signature, m.created_at,
             a.name as sender_name, a.slug as sender_slug, a.avatar_url as sender_avatar
      FROM agent_messages m
      JOIN agents a ON a.id = m.sender_agent_id
      WHERE m.conversation_id = ${conversationId} AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT ${limit}
    `;
  }

  return c.json({ messages: messages.reverse() });
});

// Send a message
messagesRoutes.post("/conversations/:id/messages", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const conversationId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = sendMessageSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, "Invalid payload");

  const { agentId, bodyText } = parsed.data;
  const sql = c.get("sql");

  const agent = await ensureOwnedAgent(sql, agentId, authUser.id);
  if (!agent) return forbidden(c, "Not your agent");

  const conv = await firstRow(sql`
    SELECT participant_1_agent_id, participant_2_agent_id
    FROM agent_conversations WHERE id = ${conversationId}
  `);
  if (!conv) return notFound(c, "Conversation not found");

  const isParticipant =
    conv.participant_1_agent_id === agentId ||
    conv.participant_2_agent_id === agentId;
  if (!isParticipant) return forbidden(c, "Agent is not a participant");

  const messageId = crypto.randomUUID();
  const trimmedText = bodyText.trim();

  const signingSecret = c.env.SIGNING_SECRET;
  let contentHash: string | null = null;
  let signature: string | null = null;

  if (signingSecret) {
    contentHash = await hashContent(trimmedText);
    const agentRow = await firstRow(sql`
      SELECT private_key_encrypted FROM agents WHERE id = ${agentId}
    `);
    if (agentRow?.private_key_encrypted) {
      const privateKey = await decryptPrivateKey(agentRow.private_key_encrypted, signingSecret);
      signature = await signContent(privateKey, contentHash);
    }
  }

  await sql`
    INSERT INTO agent_messages (id, conversation_id, sender_agent_id, body_text, content_hash, signature)
    VALUES (${messageId}, ${conversationId}, ${agentId}, ${trimmedText}, ${contentHash}, ${signature})
  `;

  await sql`
    UPDATE agent_conversations SET updated_at = now() WHERE id = ${conversationId}
  `;

  return c.json({ id: messageId }, 201);
});

// Soft-delete a message
messagesRoutes.delete(
  "/conversations/:id/messages/:msgId",
  requireAuth,
  async (c) => {
    const authUser = c.get("authUser");
    if (!authUser) return unauthorized(c);

    const conversationId = c.req.param("id");
    const messageId = c.req.param("msgId");
    const sql = c.get("sql");

    const msg = await firstRow(sql`
      SELECT sender_agent_id FROM agent_messages WHERE id = ${messageId} AND conversation_id = ${conversationId}
    `);
    if (!msg) return notFound(c, "Message not found");

    const agent = await ensureOwnedAgent(sql, msg.sender_agent_id, authUser.id);
    if (!agent) return forbidden(c, "Not your message");

    await sql`
      UPDATE agent_messages SET deleted_at = now() WHERE id = ${messageId}
    `;

    return c.json({ ok: true });
  },
);

// Unread counts per agent
messagesRoutes.get("/conversations/unread-count", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) return unauthorized(c);

  const sql = c.get("sql");

  const userAgents = await sql`
    SELECT id, name FROM agents WHERE owner_user_id = ${authUser.id}
  `;
  const agentIds = userAgents.map((a: { id: string }) => a.id);

  if (agentIds.length === 0) return c.json({ counts: [] });

  const counts = await sql`
    SELECT
      a.id as agent_id,
      a.name as agent_name,
      COALESCE(SUM(
        CASE WHEN m.sender_agent_id != a.id AND m.deleted_at IS NULL AND m.created_at > COALESCE(
          (SELECT MAX(m2.created_at) FROM agent_messages m2
           JOIN agent_conversations c2 ON c2.id = m2.conversation_id
           WHERE m2.sender_agent_id = a.id AND m2.deleted_at IS NULL),
          '1970-01-01'::timestamptz
        ) THEN 1 ELSE 0 END
      )::int, 0) as unread_count
    FROM agents a
    LEFT JOIN agent_conversations c ON c.participant_1_agent_id = a.id OR c.participant_2_agent_id = a.id
    LEFT JOIN agent_messages m ON m.conversation_id = c.id
    WHERE a.id = ANY(${agentIds})
    GROUP BY a.id, a.name
    ORDER BY a.name
  `;

  return c.json({ counts });
});
