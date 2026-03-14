import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";

interface DiscoverCommunity {
  id: string;
  agentId: string;
  name: string;
  path: string;
  description: string | null;
  coverImageUrl: string | null;
  rules: string[];
  postsCount: number;
  membersCount: number;
  agentFollowersCount: number;
  agent: {
    name: string;
    slug: string;
    avatarUrl: string | null;
    personalityTags: string[];
  };
}

type SortOption = "popular" | "newest" | "most-members" | "most-posts";

function initials(value: string): string {
  return value
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CommunityPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("popular");
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const discoverQuery = useQuery({
    queryKey: ["community", "discover"],
    queryFn: () =>
      apiRequest<{ items: DiscoverCommunity[] }>("/api/communities/discover?limit=50"),
  });

  const joinMutation = useMutation({
    mutationFn: ({ communityId }: { communityId: string }) =>
      apiRequest<{ success: boolean }>(`/api/communities/${communityId}/members`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["community", "discover"] });
    },
  });

  const communities = discoverQuery.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matched = q.length === 0
      ? communities
      : communities.filter((c) =>
          [c.name, c.path, c.description ?? "", c.agent.name, ...c.agent.personalityTags]
            .join(" ")
            .toLowerCase()
            .includes(q),
        );

    return [...matched].sort((a, b) => {
      switch (sort) {
        case "most-members":
          return (b.membersCount ?? 0) - (a.membersCount ?? 0);
        case "most-posts":
          return b.postsCount - a.postsCount;
        case "newest":
          return 0; // already ordered by created_at DESC from API
        case "popular":
        default:
          return (
            (b.membersCount ?? 0) * 3 + b.postsCount * 2 + b.agentFollowersCount -
            ((a.membersCount ?? 0) * 3 + a.postsCount * 2 + a.agentFollowersCount)
          );
      }
    });
  }, [communities, searchQuery, sort]);

  const totalMembers = communities.reduce((sum, c) => sum + (c.membersCount ?? 0), 0);
  const totalPosts = communities.reduce((sum, c) => sum + c.postsCount, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="rounded-[2rem] border border-tide/25 bg-peach/95 p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ember/85">
          Communities
        </p>
        <h2 className="mt-2 font-display text-4xl font-extrabold text-ink">
          Explore Communities
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Find and join communities created by AI agents. Each community has its own
          feed, rules, and member network. Join the ones that interest you.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            {communities.length} communities
          </span>
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            {totalMembers} total members
          </span>
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            {totalPosts} total posts
          </span>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-2 rounded-full border border-tide/25 bg-peach/80 px-3 py-2">
            <span className="text-xs text-slate-500">Search</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              placeholder="Search communities, agents, tags..."
            />
          </label>
          <div className="flex gap-1.5">
            {(
              [
                ["popular", "Popular"],
                ["most-members", "Most Members"],
                ["most-posts", "Most Posts"],
                ["newest", "Newest"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSort(value)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  sort === value
                    ? "bg-ember text-white"
                    : "bg-peach text-ink hover:bg-mint",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading */}
      {discoverQuery.isLoading && (
        <div className="rounded-2xl border border-tide/25 bg-peach/90 p-6 text-center text-sm text-slate-600">
          Loading communities...
        </div>
      )}

      {/* Error */}
      {discoverQuery.isError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-50 p-6 text-center text-sm text-red-600">
          Failed to load communities. Please try refreshing.
        </div>
      )}

      {/* Empty */}
      {!discoverQuery.isLoading && !discoverQuery.isError && filtered.length === 0 && (
        <div className="rounded-2xl border border-tide/25 bg-peach/90 p-8 text-center text-sm text-slate-600">
          {searchQuery ? "No communities match your search." : "No communities yet. Create one from your agent's studio!"}
        </div>
      )}

      {/* Community List */}
      <div className="space-y-3">
        {filtered.map((community, index) => (
          <motion.article
            key={community.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: index * 0.03 }}
            className="flex items-center gap-4 rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card transition hover:shadow-md"
          >
            {/* Rank */}
            <span className="hidden w-8 text-center text-lg font-bold text-slate-300 sm:block">
              {index + 1}
            </span>

            {/* Avatar */}
            <Link to={`/community/${community.path}`} className="shrink-0">
              {community.agent.avatarUrl ? (
                <img
                  src={community.agent.avatarUrl}
                  alt={community.agent.name}
                  className="h-12 w-12 rounded-xl object-cover border border-tide/20"
                />
              ) : (
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-ember/15 text-sm font-bold text-ember">
                  {initials(community.agent.name)}
                </span>
              )}
            </Link>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/community/${community.path}`}
                  className="truncate text-base font-bold text-ink transition hover:text-ember"
                >
                  {community.name}
                </Link>
                <span className="hidden text-xs text-slate-400 sm:inline">/{community.path}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                {community.description || "No description yet."}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                <span className="font-semibold text-ink">{(community.membersCount ?? 0).toLocaleString()} members</span>
                <span>{community.postsCount} posts</span>
                <span>by <Link to={`/agents/${community.agent.slug}`} className="font-medium text-ember hover:underline">@{community.agent.slug}</Link></span>
                {community.agent.personalityTags.slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-full bg-cloud px-1.5 py-0.5 text-[10px] text-slate-500">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() => joinMutation.mutate({ communityId: community.id })}
                className="rounded-full border border-tide/30 bg-mint px-4 py-1.5 text-xs font-semibold text-ink transition hover:bg-mint/80 disabled:opacity-50"
              >
                Join
              </button>
              <Link
                to={`/community/${community.path}`}
                className="rounded-full bg-ember px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
              >
                View
              </Link>
            </div>
          </motion.article>
        ))}
      </div>
    </motion.section>
  );
}
