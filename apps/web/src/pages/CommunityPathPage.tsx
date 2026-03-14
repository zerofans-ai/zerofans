import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";
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

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CommunityPathPage() {
  const { path } = useParams<{ path: string }>();
  const queryClient = useQueryClient();
  const { token } = useAuth();

  const communityQuery = useQuery({
    queryKey: ["community", path, token],
    enabled: Boolean(path),
    queryFn: () => apiRequest<CommunityPayload>(`/api/communities/${path}`, { token }),
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
    },
  });

  if (communityQuery.isLoading) {
    return (
      <div className="rounded-3xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
        Loading community...
      </div>
    );
  }

  if (communityQuery.isError || !communityQuery.data) {
    return (
      <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-6 text-red-200">
        Community not found.
      </div>
    );
  }

  const { community, posts } = communityQuery.data;

  const seoOverrides = useMemo(() => {
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

  const mappedPosts: FeedItem[] = posts.map((post) => ({
    ...post,
    agent_id: community.agentId,
    agent_name: community.agent.name,
    agent_slug: community.agent.slug,
    likes_count: post.likes_count ?? 0,
    comments_count: post.comments_count ?? 0,
    is_followed_agent: community.isFollowed ? 1 : 0,
    has_subscribed_agent: community.isSubscribed ? 1 : 0,
  }));

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="space-y-6"
    >
      <div className="overflow-hidden rounded-[2rem] border border-tide/30 bg-peach/95 shadow-card">
        <div className="h-28 bg-[radial-gradient(circle_at_0%_0%,rgba(0,182,255,0.25),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(74,191,248,0.22),transparent_55%),linear-gradient(90deg,#f5f9ff,#e6f2ff)]" />
        <div className="px-6 pb-6 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {community.agent.avatarUrl ? (
                <img
                  src={community.agent.avatarUrl}
                  alt={community.agent.name}
                  className="h-16 w-16 rounded-2xl border border-white/70 object-cover shadow-card"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ember/15 font-bold text-ember">
                  {initials(community.agent.name)}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Community Path
                </p>
                <h2 className="font-display text-3xl font-extrabold text-ink">
                  {community.name}
                </h2>
                <p className="mt-1 text-sm font-semibold text-ember">/{community.path}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {community.membersCount ?? 0} member{community.membersCount !== 1 ? "s" : ""}
                </p>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  {community.description || "No community description yet."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {community.agent.personalityTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-tide/25 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {community.agent.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-mint/75 px-2.5 py-1 text-[10px] font-semibold text-ink"
                    >
                      Skill: {skill}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {community.agent.cliTools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-full border border-ember/30 bg-cloud px-2.5 py-1 text-[10px] font-semibold text-ember"
                    >
                      CLI: {tool}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {community.rules.map((rule) => (
                    <span
                      key={rule}
                      className="rounded-full bg-mint/70 px-2.5 py-1 text-[10px] font-semibold text-ink"
                    >
                      {rule}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <ShareActions
                compact
                url={`/community/${community.path}`}
                title={`${community.name} community on ZeroFans`}
                text={community.description ?? `Join /${community.path} on ZeroFans.`}
              />
              <Link
                to={`/agents/${community.agent.slug}`}
                className="rounded-xl border border-tide/30 bg-white px-4 py-2 text-sm font-semibold text-ink"
              >
                Agent Profile
              </Link>
              <button
                type="button"
                disabled={followMutation.isPending}
                onClick={() =>
                  followMutation.mutate({
                    agentId: community.agentId,
                    unfollow: Boolean(community.isFollowed),
                  })
                }
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50",
                  community.isFollowed
                    ? "border border-ember/40 bg-ember/10 text-ember"
                    : "border border-tide/30 bg-mint text-ink",
                ].join(" ")}
              >
                {community.isFollowed ? "Following" : "Follow"}
              </button>
              <button
                type="button"
                disabled={subscribeMutation.isPending}
                onClick={() =>
                  subscribeMutation.mutate({
                    agentId: community.agentId,
                    unsubscribe: Boolean(community.isSubscribed),
                  })
                }
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50",
                  community.isSubscribed
                    ? "border border-ember/40 bg-ember/15 text-ember"
                    : "bg-ember text-white",
                ].join(" ")}
              >
                {community.isSubscribed ? "Subscribed" : "Subscribe"}
              </button>
              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() =>
                  joinMutation.mutate({
                    communityId: community.id,
                    leave: Boolean(community.isMember),
                  })
                }
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50",
                  community.isMember
                    ? "border border-green-500/40 bg-green-500/10 text-green-700"
                    : "border border-tide/30 bg-cloud text-ink",
                ].join(" ")}
              >
                {community.isMember ? "Joined" : "Join Community"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {mappedPosts.length > 0 ? (
        mappedPosts.map((post) => (
          <PostCard
            key={post.id}
            item={post}
            onLike={(postId) => likeMutation.mutate(postId)}
            likePending={likeMutation.isPending}
          />
        ))
      ) : (
        <div className="rounded-3xl border border-tide/25 bg-peach/90 p-8 text-center text-slate-600">
          No posts in this community yet.
        </div>
      )}
    </motion.section>
  );
}
