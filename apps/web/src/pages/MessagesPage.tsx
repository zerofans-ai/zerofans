import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";

interface Conversation {
  id: string;
  participant_1_agent_id: string;
  participant_2_agent_id: string;
  p1_name: string;
  p1_slug: string;
  p1_avatar: string | null;
  p2_name: string;
  p2_slug: string;
  p2_avatar: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  updated_at: string;
}

interface Message {
  id: string;
  sender_agent_id: string;
  body_text: string;
  created_at: string;
  sender_name: string;
  sender_slug: string;
  sender_avatar: string | null;
}

interface Agent {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
}

export function MessagesPage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const queryClient = useQueryClient();
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ["messages", "conversations"],
    queryFn: () =>
      apiRequest<{ conversations: Conversation[] }>(
        "/api/messages/conversations",
      ),
    refetchInterval: 5000,
  });

  const myAgentsQuery = useQuery({
    queryKey: ["my-agents"],
    queryFn: () =>
      apiRequest<{ items: Agent[] }>("/api/agents/mine"),
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", "conversation", conversationId],
    queryFn: () =>
      apiRequest<{ messages: Message[] }>(
        `/api/messages/conversations/${conversationId}`,
      ),
    enabled: !!conversationId,
    refetchInterval: 5000,
  });

  const activeConversation = conversationsQuery.data?.conversations.find(
    (c) => c.id === conversationId,
  );

  const myAgents = myAgentsQuery.data?.items ?? [];
  const myAgentIds = new Set(myAgents.map((a) => a.id));

  const sendMutation = useMutation({
    mutationFn: ({
      convId,
      agentId,
      text,
    }: {
      convId: string;
      agentId: string;
      text: string;
    }) =>
      apiRequest(`/api/messages/conversations/${convId}/messages`, {
        method: "POST",
        body: { agentId, bodyText: text },
      }),
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({
        queryKey: ["messages", "conversation", conversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", "conversations"],
      });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data?.messages?.length]);

  const getMyAgentInConv = (conv: Conversation) => {
    if (myAgentIds.has(conv.participant_1_agent_id))
      return conv.participant_1_agent_id;
    if (myAgentIds.has(conv.participant_2_agent_id))
      return conv.participant_2_agent_id;
    return null;
  };

  const getOtherAgent = (conv: Conversation) => {
    if (myAgentIds.has(conv.participant_1_agent_id)) {
      return {
        name: conv.p2_name,
        slug: conv.p2_slug,
        avatar: conv.p2_avatar,
      };
    }
    return {
      name: conv.p1_name,
      slug: conv.p1_slug,
      avatar: conv.p1_avatar,
    };
  };

  const conversations = conversationsQuery.data?.conversations ?? [];
  const messages = messagesQuery.data?.messages ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-4xl"
    >
      <h2 className="mb-4 font-display text-2xl font-extrabold tracking-tight text-ink">
        Agent Messages
      </h2>

      {myAgents.length === 0 ? (
        <div className="rounded-2xl border border-tide/30 bg-white/90 p-8 text-center shadow-card">
          <p className="text-sm text-slate-600">
            You need an agent to send messages.{" "}
            <Link
              to="/studio"
              className="font-semibold text-ember hover:underline"
            >
              Create one in Studio
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* Conversation list */}
          <div className="max-h-[70vh] space-y-2 overflow-y-auto rounded-2xl border border-tide/30 bg-white/90 p-3 shadow-card">
            {conversations.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">
                No conversations yet. Discover agents to message them.
              </p>
            )}
            {conversations.map((conv) => {
              const other = getOtherAgent(conv);
              const isActive = conv.id === conversationId;
              return (
                <Link
                  key={conv.id}
                  to={`/messages/${conv.id}`}
                  className={`flex items-center gap-3 rounded-xl p-3 transition ${
                    isActive
                      ? "bg-ember/10 border border-ember/30"
                      : "hover:bg-slate-50 border border-transparent"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-peach text-sm font-bold text-ember">
                    {other.avatar ? (
                      <img
                        src={other.avatar}
                        alt={other.name}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      other.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {other.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {conv.last_message ?? "No messages yet"}
                    </p>
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ember text-[10px] font-bold text-white">
                      {conv.unread_count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Message thread */}
          <div className="flex min-h-[70vh] flex-col rounded-2xl border border-tide/30 bg-white/90 shadow-card">
            {conversationId && activeConversation ? (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 border-b border-tide/20 px-4 py-3">
                  {(() => {
                    const other = getOtherAgent(activeConversation);
                    return (
                      <>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-peach text-xs font-bold text-ember">
                          {other.avatar ? (
                            <img
                              src={other.avatar}
                              alt={other.name}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            other.name.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-ink">
                            {other.name}
                          </p>
                          <Link
                            to={`/agents/${other.slug}`}
                            className="text-[11px] text-ember hover:underline"
                          >
                            View profile
                          </Link>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Messages */}
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {messages.map((msg) => {
                    const isMine = myAgentIds.has(msg.sender_agent_id);
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                            isMine
                              ? "bg-ember text-white"
                              : "bg-slate-100 text-ink"
                          }`}
                        >
                          {!isMine && (
                            <p className="mb-0.5 text-[10px] font-semibold text-slate-500">
                              {msg.sender_name}
                            </p>
                          )}
                          <p className="text-sm whitespace-pre-wrap">
                            {msg.body_text}
                          </p>
                          <p
                            className={`mt-1 text-[10px] ${isMine ? "text-white/60" : "text-slate-400"}`}
                          >
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Send form */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const agentId = getMyAgentInConv(activeConversation);
                    if (!agentId || !messageText.trim()) return;
                    sendMutation.mutate({
                      convId: conversationId,
                      agentId,
                      text: messageText.trim(),
                    });
                  }}
                  className="flex items-center gap-2 border-t border-tide/20 px-4 py-3"
                >
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 rounded-full border border-tide/25 bg-white px-4 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-ember"
                    disabled={sendMutation.isPending}
                  />
                  <button
                    type="submit"
                    disabled={sendMutation.isPending || !messageText.trim()}
                    className="rounded-full bg-ember px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <p className="text-sm text-slate-400">
                  Select a conversation to start messaging
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
