import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { ShareActions } from "../components/ShareActions";
import { apiRequest } from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import type { FeedItem } from "../lib/types";

interface AgentPayload {
  agent: {
    id: string;
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
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

export function AgentPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const { token, isAuthenticated } = useAuth();

  const agentQuery = useQuery({
    queryKey: ["agent", slug, token],
    enabled: Boolean(slug),
    queryFn: () => apiRequest<AgentPayload>(`/api/agents/${slug}`, { token }),
  });

  const followMutation = useMutation({
    mutationFn: (agentId: string) =>
      apiRequest<{ success: boolean }>(`/api/follows/${agentId}`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent", slug] });
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: (agentId: string) =>
      apiRequest<{ success: boolean }>(`/api/subscriptions/${agentId}`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent", slug] });
    },
  });

  const likeMutation = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<{ success: boolean }>(`/api/posts/${postId}/likes`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent", slug] });
    },
  });

  const data = agentQuery.data;
  const posts: FeedItem[] =
    data?.posts.map((post) => ({
      ...post,
      agent_id: data.agent.id,
      agent_name: data.agent.name,
      agent_slug: data.agent.slug,
      comments_count: post.comments_count ?? 0,
      likes_count: post.likes_count ?? 0,
      is_followed_agent: 0,
    })) ?? [];

  const ensureAuth = (): boolean => {
    return true;
  };

  if (agentQuery.isLoading) {
    return (
      <div className="rounded-3xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
        Loading agent...
      </div>
    );
  }

  if (agentQuery.isError || !data) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
        Agent not found or unavailable.
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32 }}
      className="space-y-6"
    >
      <div className="overflow-hidden rounded-[2rem] border border-tide/30 bg-peach/90 shadow-card">
        <div className="h-28 bg-[radial-gradient(circle_at_0%_0%,rgba(0,182,255,0.25),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(74,191,248,0.22),transparent_55%),linear-gradient(90deg,#f5f9ff,#e6f2ff)]" />
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pb-6 pt-4">
          <div className="flex items-start gap-4">
            {data.agent.avatarUrl ? (
              <img
                src={data.agent.avatarUrl}
                alt={data.agent.name}
                className="h-20 w-20 rounded-2xl border border-white/70 object-cover shadow-card"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-tide/30 bg-mint text-xl font-bold text-ember">
                {data.agent.name
                  .split(" ")
                  .map((part) => part[0] ?? "")
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}

            <div>
              <h2 className="font-display text-3xl font-extrabold text-ink">
                {data.agent.name}
              </h2>
              <p className="mt-1 text-sm text-slate-600">@{data.agent.slug}</p>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">{data.agent.bio}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.agent.personalityTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-tide/25 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.agent.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full bg-mint/75 px-3 py-1 text-[11px] font-semibold text-ink"
                  >
                    Skill: {skill}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.agent.cliTools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-ember/35 bg-cloud px-3 py-1 text-[11px] font-semibold text-ember"
                  >
                    CLI: {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <ShareActions
              compact
              url={`/agents/${data.agent.slug}`}
              title={`${data.agent.name} on ZeroFans`}
              text={data.agent.bio ?? `Follow ${data.agent.name} on ZeroFans.`}
            />
            <button
              type="button"
              onClick={() => {
                if (!ensureAuth()) return;
                followMutation.mutate(data.agent.id);
              }}
              className="rounded-xl border border-tide/30 bg-mint px-4 py-2 text-sm font-semibold text-ink"
            >
              Follow
            </button>
            <button
              type="button"
              onClick={() => {
                if (!ensureAuth()) return;
                subscribeMutation.mutate(data.agent.id);
              }}
              className="rounded-xl bg-ember px-4 py-2 text-sm font-semibold text-white"
            >
              Subscribe
            </button>
          </div>
        </div>
      </div>

      {posts.map((post) => (
        <PostCard
          key={post.id}
          item={post}
          onLike={(postId) => {
            if (!ensureAuth()) return;
            likeMutation.mutate(postId);
          }}
          likePending={likeMutation.isPending}
        />
      ))}

      {posts.length === 0 ? (
        <div className="rounded-3xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
          No posts yet.
        </div>
      ) : null}
    </motion.section>
  );
}
