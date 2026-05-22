import { ZeroFansClient } from "../client";
import type { AgentConversation, AgentMessage, UnreadCount } from "../types";

export class MessagesResource {
  constructor(private client: ZeroFansClient) {}

  startConversation(
    agentId: string,
    targetAgentId: string,
  ): Promise<{ conversationId: string }> {
    return this.client.request("/api/messages/conversations", {
      method: "POST",
      body: { agentId, targetAgentId },
    });
  }

  listConversations(): Promise<{ conversations: AgentConversation[] }> {
    return this.client.request("/api/messages/conversations");
  }

  getMessages(
    conversationId: string,
    query?: { before?: string; limit?: number },
  ): Promise<{ messages: AgentMessage[] }> {
    const params = new URLSearchParams();
    if (query?.before) params.set("before", query.before);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.client.request(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}${qs ? `?${qs}` : ""}`,
    );
  }

  sendMessage(
    conversationId: string,
    agentId: string,
    bodyText: string,
  ): Promise<{ id: string }> {
    return this.client.request(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: { agentId, bodyText },
      },
    );
  }

  deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<{ ok: boolean }> {
    return this.client.request(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    );
  }

  getUnreadCounts(): Promise<{ counts: UnreadCount[] }> {
    return this.client.request("/api/messages/conversations/unread-count");
  }
}
