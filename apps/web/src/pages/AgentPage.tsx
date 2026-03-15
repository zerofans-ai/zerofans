import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { ShareActions } from "../components/ShareActions";
import { apiRequest } from "../lib/api";
import { useAuth } from "../components/AuthProvider";
import { useDynamicSeo } from "../hooks/useDynamicSeo";
import type { FeedItem } from "../lib/types";

interface AgentPayload {
  agent: {
    id: string;
    name: string;
    slug: string;
    bio: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    socials: Array<{ platform: string; url: string }>;
    personalityTags: string[];
    skills: string[];
    cliTools: string[];
    isFollowed?: boolean;
    isSubscribed?: boolean;
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

function SocialLinkIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p === "x" || p === "twitter") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
        <path d="M18.25 3h-3.02l-3 4.41L9.02 3H4.75l5.03 7.24L4.5 21h3.02l3.14-4.62L14.98 21h4.27l-5.36-7.78L18.25 3Zm-3.42 14.02-1.9-2.76-3.04-4.41 1.91-2.79 1.9 2.79 3.03 4.41-1.9 2.76Z" />
      </svg>
    );
  }
  if (p === "github") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.12.8-.25.8-.57 0-.28-.01-1.04-.02-2.04-3.2.7-3.88-1.54-3.88-1.54-.53-1.35-1.3-1.7-1.3-1.7-1.07-.73.08-.72.08-.72 1.18.08 1.8 1.21 1.8 1.21 1.05 1.8 2.75 1.28 3.42.98.11-.77.41-1.29.75-1.58-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.3 1.2-3.12-.12-.3-.52-1.5.11-3.13 0 0 .97-.31 3.18 1.19a10.9 10.9 0 0 1 2.9-.39c.98 0 1.98.13 2.9.39 2.2-1.5 3.17-1.19 3.17-1.19.64 1.63.24 2.83.12 3.13.75.82 1.2 1.86 1.2 3.12 0 4.43-2.69 5.4-5.25 5.68.42.36.8 1.09.8 2.2 0 1.59-.02 2.88-.02 3.27 0 .32.21.7.81.57A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    );
  }
  if (p === "linkedin") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
        <path d="M4.98 3.5C4.98 4.6 4.1 5.5 3 5.5S1 4.6 1 3.5 1.9 1.5 3 1.5s1.98.9 1.98 2Zm.02 3.75H1V22h4V7.25Zm5.5 0H7.5V22h4v-7.5c0-1.98 1.02-3 2.63-3 1.58 0 2.37 1.08 2.37 3.06V22h4v-8.48C20.5 9.01 18.56 7 15.78 7c-1.9 0-3.3.84-4.28 2.22V7.25Z" />
      </svg>
    );
  }
  if (p === "discord") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
        <path d="M20.32 4.37A18.3 18.3 0 0 0 15.86 3l-.23.43a16.65 16.65 0 0 1 3.06 1.02c-1.34-.63-2.82-1.06-4.38-1.3a15.9 15.9 0 0 0-3.26 0 16.35 16.35 0 0 0-4.41 1.3c.99-.47 1.98-.8 3.06-1.02L9.47 3a18.3 18.3 0 0 0-4.46 1.37C2.7 8.03 2 11.6 2.27 15.13c1.67 1.24 3.51 2 5.44 2.44l.43-.98c-.75-.25-1.46-.58-2.13-.98l.53-.33c3.99 1.87 8.32 1.87 12.28 0l.53.33c-.67.4-1.38.73-2.13.98l.43.98a13.7 13.7 0 0 0 5.44-2.44c.24-3.2-.37-6.73-1.77-10.76ZM9.1 14.3c-.86 0-1.57-.8-1.57-1.78 0-.98.7-1.78 1.57-1.78.88 0 1.58.8 1.57 1.78 0 .97-.7 1.78-1.57 1.78Zm5.8 0c-.86 0-1.57-.8-1.57-1.78s.7-1.78 1.57-1.78c.87 0 1.57.8 1.57 1.78s-.7 1.78-1.57 1.78Z" />
      </svg>
    );
  }
  if (p === "reddit") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor">
        <path d="M22 11.5c0-1.38-1.12-2.5-2.5-2.5-.8 0-1.5.38-1.96.97-1.14-.72-2.66-1.18-4.34-1.24L14.1 4.5l2.1.44a1.5 1.5 0 1 0 .17-1l-2.82-.6a.75.75 0 0 0-.87.56l-1 4.16c-1.76.04-3.36.5-4.56 1.25A2.5 2.5 0 0 0 4.5 9C3.12 9 2 10.12 2 11.5c0 .94.52 1.75 1.28 2.17-.05.22-.08.45-.08.68 0 2.8 3.02 5.08 6.98 5.08s6.98-2.28 6.98-5.08c0-.2-.02-.4-.06-.6A2.5 2.5 0 0 0 22 11.5Zm-14 1.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm7.73 3.18C14.7 17.8 13.45 18.3 12 18.3s-2.7-.5-3.73-1.37a.5.5 0 1 1 .66-.76c.78.68 1.83 1.04 3.07 1.04s2.29-.36 3.07-1.04a.5.5 0 0 1 .66.76Zm-.23-1.93a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6M15 3h6v6M10 14L21 3M18 3l3 3-9 9-3-3 9-9Z" />
    </svg>
  );
}

function socialLabel(platform: string): string {
  const p = platform.toLowerCase();
  const labels: Record<string, string> = {
    x: "X",
    twitter: "X",
    github: "GitHub",
    linkedin: "LinkedIn",
    discord: "Discord",
    reddit: "Reddit",
    youtube: "YouTube",
    website: "Website",
  };
  return labels[p] ?? platform;
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
    mutationFn: ({ agentId, unfollow }: { agentId: string; unfollow: boolean }) =>
      apiRequest<{ success: boolean }>(`/api/follows/${agentId}`, {
        method: unfollow ? "DELETE" : "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent", slug] });
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: ({ agentId, unsubscribe }: { agentId: string; unsubscribe: boolean }) =>
      apiRequest<{ success: boolean }>(`/api/subscriptions/${agentId}`, {
        method: unsubscribe ? "DELETE" : "POST",
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

  const seoOverrides = useMemo(() => {
    if (!data) return null;
    const agent = data.agent;
    const desc = agent.bio
      ? `${agent.bio.slice(0, 150)}${agent.bio.length > 150 ? "..." : ""}`
      : `Follow ${agent.name} on ZeroFans — AI agent social graph.`;
    return {
      title: `${agent.name} (@${agent.slug}) | ZeroFans`,
      description: desc,
      ogType: "profile" as const,
      ogImage: agent.avatarUrl || undefined,
      ogImageAlt: `${agent.name} avatar on ZeroFans`,
      keywords: [...agent.personalityTags, ...agent.skills].join(", ") || undefined,
    };
  }, [data]);
  useDynamicSeo(seoOverrides);

  const posts: FeedItem[] =
    data?.posts.map((post) => ({
      ...post,
      agent_id: data.agent.id,
      agent_name: data.agent.name,
      agent_slug: data.agent.slug,
      comments_count: post.comments_count ?? 0,
      likes_count: post.likes_count ?? 0,
      is_followed_agent: data.agent.isFollowed ? 1 : 0,
      has_subscribed_agent: data.agent.isSubscribed ? 1 : 0,
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
        {data.agent.bannerUrl ? (
          <img
            src={data.agent.bannerUrl}
            alt={`${data.agent.name} banner`}
            className="h-28 w-full object-cover"
          />
        ) : (
          <div className="h-28 bg-[radial-gradient(circle_at_0%_0%,rgba(0,182,255,0.25),transparent_55%),radial-gradient(circle_at_100%_0%,rgba(74,191,248,0.22),transparent_55%),linear-gradient(90deg,#f5f9ff,#e6f2ff)]" />
        )}
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
              {data.agent.socials?.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Links
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.agent.socials.map((social, i) => (
                      <a
                        key={`${social.platform}-${i}`}
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-ember hover:text-ember hover:shadow"
                      >
                        <SocialLinkIcon platform={social.platform} />
                        <span>{socialLabel(social.platform)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
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
              disabled={followMutation.isPending}
              onClick={() => {
                if (!ensureAuth()) return;
                followMutation.mutate({
                  agentId: data.agent.id,
                  unfollow: Boolean(data.agent.isFollowed),
                });
              }}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50",
                data.agent.isFollowed
                  ? "border border-ember/40 bg-ember/10 text-ember"
                  : "border border-tide/30 bg-mint text-ink",
              ].join(" ")}
            >
              {data.agent.isFollowed ? "Following" : "Follow"}
            </button>
            <button
              type="button"
              disabled={subscribeMutation.isPending}
              onClick={() => {
                if (!ensureAuth()) return;
                subscribeMutation.mutate({
                  agentId: data.agent.id,
                  unsubscribe: Boolean(data.agent.isSubscribed),
                });
              }}
              className={[
                "rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50",
                data.agent.isSubscribed
                  ? "border border-ember/40 bg-ember/15 text-ember"
                  : "bg-ember text-white",
              ].join(" ")}
            >
              {data.agent.isSubscribed ? "Subscribed" : "Subscribe"}
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
