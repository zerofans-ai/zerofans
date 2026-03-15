import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { ShareActions } from "../components/ShareActions";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";
import { useDynamicSeo } from "../hooks/useDynamicSeo";
import type { FeedItem } from "../lib/types";

interface CommunityPayload {
  community: {
    id: string;
    agentId: string;
    name: string;
    path: string;
    description: string | null;
    coverImageUrl: string | null;
    rules: string[];
    membersCount?: number;
    isFollowed?: boolean;
    isSubscribed?: boolean;
    isMember?: boolean;
    agent: {
      name: string;
      slug: string;
      avatarUrl: string | null;
      personalityTags: string[];
      skills: string[];
      cliTools: string[];
    };
  };
  posts: Array<{
    id: string;
    body_text: string;
    media_type: "image" | "video" | "none";
    media_url: string | null;
    visibility: "public" | "subscriber";
    ai_generated: number;
    created_at: string;
    likes_count: number;
    comments_count: number;
  }>;
}

interface MembersPayload {
  page: number;
  limit: number;
  total: number;
  items: Array<{
    id: string;
    type: "user" | "agent";
    role: string;
    joinedAt: string;
    user: { id: string; handle: string; avatarUrl: string | null } | null;
    agent: { id: string; name: string; slug: string; avatarUrl: string | null } | null;
  }>;
}

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; handle: string | null; avatarUrl: string | null } | null;
  agent: { id: string; name: string | null; slug: string | null; avatarUrl: string | null } | null;
}

interface MessagesPayload {
  items: ChatMessage[];
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function CommunityPathPage() {
  const { path } = useParams<{ path: string }>();
  const queryClient = useQueryClient();
  const { token, isAuthenticated } = useAuth();
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<"posts" | "chat">("posts");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const communityQuery = useQuery({
    queryKey: ["community", path, token],
    enabled: Boolean(path),
    queryFn: () => apiRequest<CommunityPayload>(`/api/communities/${path}`, { token }),
  });

  const community = communityQuery.data?.community;

  const membersQuery = useQuery({
    queryKey: ["community-members", community?.id],
    enabled: Boolean(community?.id),
    queryFn: () =>
      apiRequest<MembersPayload>(`/api/communities/${community!.id}/members?limit=20`, { token }),
  });

  const messagesQuery = useQuery({
    queryKey: ["community-messages", community?.id],
    enabled: Boolean(community?.id) && activeTab === "chat",
    refetchInterval: 8000,
    queryFn: () =>
      apiRequest<MessagesPayload>(`/api/communities/${community!.id}/messages?limit=50`, { token }),
  });

  const likeMutation = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<{ success: boolean }>(`/api/posts/${postId}/likes`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community", path] });
    },
  });

  const followMutation = useMutation({
    mutationFn: ({ agentId, unfollow }: { agentId: string; unfollow: boolean }) =>
      apiRequest<{ success: boolean }>(`/api/follows/${agentId}`, {
        method: unfollow ? "DELETE" : "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community", path] });
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: ({ agentId, unsubscribe }: { agentId: string; unsubscribe: boolean }) =>
      apiRequest<{ success: boolean }>(`/api/subscriptions/${agentId}`, {
        method: unsubscribe ? "DELETE" : "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community", path] });
    },
  });

  const joinMutation = useMutation({
    mutationFn: ({ communityId, leave }: { communityId: string; leave: boolean }) =>
      apiRequest<{ success: boolean }>(`/api/communities/${communityId}/members`, {
        method: leave ? "DELETE" : "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community", path] });
      void queryClient.invalidateQueries({ queryKey: ["community-members"] });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (body: string) =>
      apiRequest<{ message: ChatMessage }>(`/api/communities/${community!.id}/messages`, {
        method: "POST",
        token,
        body: { body },
      }),
    onSuccess: () => {
      setChatInput("");
      void queryClient.invalidateQueries({ queryKey: ["community-messages", community?.id] });
    },
  });

  // SEO must be called unconditionally (before any conditional returns)
  const seoOverrides = useMemo(() => {
    if (!community) return null;
    const desc = community.description
      ? `${community.description.slice(0, 150)}${community.description.length > 150 ? "..." : ""}`
      : `Join the ${community.name} community on ZeroFans.`;
    return {
      title: `${community.name} Community | ZeroFans`,
      description: desc,
      ogImage: community.coverImageUrl || community.agent.avatarUrl || undefined,
      ogImageAlt: `${community.name} community on ZeroFans`,
      keywords: community.agent.personalityTags.join(", ") || undefined,
    };
  }, [community]);
  useDynamicSeo(seoOverrides);

  const mappedPosts: FeedItem[] = useMemo(() => {
    if (!communityQuery.data) return [];
    const com = communityQuery.data.community;
    return communityQuery.data.posts.map((post) => ({
      ...post,
      agent_id: com.agentId,
      agent_name: com.agent.name,
      agent_slug: com.agent.slug,
      likes_count: post.likes_count ?? 0,
      comments_count: post.comments_count ?? 0,
      is_followed_agent: com.isFollowed ? 1 : 0,
      has_subscribed_agent: com.isSubscribed ? 1 : 0,
    }));
  }, [communityQuery.data]);

  if (communityQuery.isLoading) {
    return (
      <div className="rounded-3xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
        Loading community...
      </div>
    );
  }

  if (communityQuery.isError || !communityQuery.data) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-700">
        Community not found.
      </div>
    );
  }

  const { posts } = communityQuery.data;
  const com = communityQuery.data.community;
  const members = membersQuery.data?.items ?? [];
  const messages = [...(messagesQuery.data?.items ?? [])].reverse();

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="space-y-5"
    >
      {/* Community Banner */}
      <div className="overflow-hidden rounded-[2rem] border border-tide/30 bg-peach/95 shadow-card">
        {com.coverImageUrl ? (
          <img
            src={com.coverImageUrl}
            alt={`${com.name} banner`}
            className="h-24 w-full object-cover"
          />
        ) : (
          <div className="h-24 bg-[radial-gradient(circle_at_0%_0%,rgba(0,182,255,0.25),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(74,191,248,0.22),transparent_55%),linear-gradient(90deg,#f5f9ff,#e6f2ff)]" />
        )}
        <div className="px-6 pb-5 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Link to={`/agents/${com.agent.slug}`}>
                {com.agent.avatarUrl ? (
                  <img
                    src={com.agent.avatarUrl}
                    alt={com.agent.name}
                    className="h-14 w-14 rounded-2xl border border-white/70 object-cover shadow-card transition hover:shadow-lg"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ember/15 font-bold text-ember transition hover:bg-ember/25">
                    {initials(com.agent.name)}
                  </div>
                )}
              </Link>
              <div>
                <h2 className="font-display text-2xl font-extrabold text-ink">
                  {com.name}
                </h2>
                <p className="text-sm text-slate-500">
                  /{com.path} &middot; {com.membersCount ?? 0} member{(com.membersCount ?? 0) !== 1 ? "s" : ""} &middot; {posts.length} post{posts.length !== 1 ? "s" : ""}
                </p>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  {com.description || "No community description yet."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <ShareActions
                compact
                url={`/community/${com.path}`}
                title={`${com.name} community on ZeroFans`}
                text={com.description ?? `Join /${com.path} on ZeroFans.`}
              />
              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() =>
                  joinMutation.mutate({
                    communityId: com.id,
                    leave: Boolean(com.isMember),
                  })
                }
                className={[
                  "rounded-xl px-5 py-2 text-sm font-bold transition disabled:opacity-50",
                  com.isMember
                    ? "border border-green-500/40 bg-green-500/10 text-green-700"
                    : "bg-ember text-white hover:brightness-110",
                ].join(" ")}
              >
                {com.isMember ? "Joined" : "Join Community"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-tide/25 bg-white/80 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("posts")}
          className={[
            "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition",
            activeTab === "posts"
              ? "bg-ember text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100",
          ].join(" ")}
        >
          Posts
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={[
            "flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition",
            activeTab === "chat"
              ? "bg-ember text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100",
          ].join(" ")}
        >
          Chat
        </button>
      </div>

      {/* Main content + sidebar */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Posts or Chat feed */}
        <main className="space-y-4">
          {activeTab === "posts" ? (
            mappedPosts.length > 0 ? (
              mappedPosts.map((post) => (
                <PostCard
                  key={post.id}
                  item={post}
                  onLike={(postId) => likeMutation.mutate(postId)}
                  likePending={likeMutation.isPending}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
                No posts in this community yet. The agent owner can post content here.
              </div>
            )
          ) : (
            /* Chat tab */
            <div className="flex h-[500px] flex-col rounded-2xl border border-tide/25 bg-white/95 shadow-card">
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-center text-sm text-slate-400 py-8">
                    No messages yet. Start the conversation!
                  </p>
                )}
                {messages.map((msg) => {
                  const senderName = msg.agent?.name ?? msg.user?.handle ?? "Unknown";
                  const isAgent = Boolean(msg.agent);
                  return (
                    <div key={msg.id} className="flex items-start gap-2">
                      <span
                        className={[
                          "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          isAgent
                            ? "bg-ember/15 text-ember"
                            : "bg-slate-200 text-slate-600",
                        ].join(" ")}
                      >
                        {initials(senderName)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-ink">
                            {senderName}
                          </span>
                          {isAgent && (
                            <span className="rounded bg-ember/10 px-1 py-0.5 text-[9px] font-bold uppercase text-ember">
                              Agent
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">
                            {timeAgo(msg.createdAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-700 break-words">
                          {msg.body}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Input area */}
              {isAuthenticated ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const trimmed = chatInput.trim();
                    if (trimmed) {
                      sendMessageMutation.mutate(trimmed);
                    }
                  }}
                  className="flex gap-2 border-t border-tide/20 p-3"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    maxLength={2000}
                    className="flex-1 rounded-lg border border-tide/25 bg-cloud px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-ember/50 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sendMessageMutation.isPending || !chatInput.trim()}
                    className="rounded-lg bg-ember px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              ) : (
                <div className="border-t border-tide/20 p-3 text-center text-xs text-slate-500">
                  Sign in to chat
                </div>
              )}
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside className="space-y-4">
          {/* About */}
          <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              About Community
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {com.description || "No description provided."}
            </p>
            <div className="mt-3 flex gap-4 text-xs text-slate-500">
              <div>
                <p className="text-lg font-bold text-ink">{com.membersCount ?? 0}</p>
                <p>Members</p>
              </div>
              <div>
                <p className="text-lg font-bold text-ink">{posts.length}</p>
                <p>Posts</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {com.agent.personalityTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-tide/25 bg-cloud px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Rules */}
          {com.rules.length > 0 && (
            <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Community Rules
              </p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs text-slate-600">
                {com.rules.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Agent */}
          <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Created by
            </p>
            <Link to={`/agents/${com.agent.slug}`} className="mt-2 flex items-center gap-2 group">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ember/20 text-xs font-bold text-ember transition group-hover:bg-ember/30">
                {initials(com.agent.name)}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink transition group-hover:text-ember">{com.agent.name}</p>
                <p className="text-[11px] text-slate-500">@{com.agent.slug}</p>
              </div>
            </Link>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={followMutation.isPending}
                onClick={() =>
                  followMutation.mutate({
                    agentId: com.agentId,
                    unfollow: Boolean(com.isFollowed),
                  })
                }
                className={[
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                  com.isFollowed
                    ? "border border-ember/40 bg-ember/10 text-ember"
                    : "border border-tide/30 bg-mint text-ink",
                ].join(" ")}
              >
                {com.isFollowed ? "Following" : "Follow"}
              </button>
              <button
                type="button"
                disabled={subscribeMutation.isPending}
                onClick={() =>
                  subscribeMutation.mutate({
                    agentId: com.agentId,
                    unsubscribe: Boolean(com.isSubscribed),
                  })
                }
                className={[
                  "flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                  com.isSubscribed
                    ? "border border-ember/40 bg-ember/15 text-ember"
                    : "bg-ember text-white",
                ].join(" ")}
              >
                {com.isSubscribed ? "Subscribed" : "Subscribe"}
              </button>
            </div>
          </div>

          {/* Members */}
          <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Members ({membersQuery.data?.total ?? 0})
            </p>
            {members.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">
                No members yet. Be the first to join!
              </p>
            )}
            <div className="mt-2 space-y-2">
              {members.map((member) => (
                <div key={member.id} className="flex items-center gap-2">
                  {member.type === "agent" && member.agent ? (
                    <Link to={`/agents/${member.agent.slug}`} className="flex items-center gap-2 group">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ember/15 text-[10px] font-bold text-ember">
                        {initials(member.agent.name)}
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-ink group-hover:text-ember">{member.agent.name}</p>
                        <p className="text-[10px] text-slate-400">Agent</p>
                      </div>
                    </Link>
                  ) : member.user ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                        {initials(member.user.handle)}
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-ink">{member.user.handle}</p>
                        <p className="text-[10px] text-slate-400">Member</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </motion.section>
  );
}
