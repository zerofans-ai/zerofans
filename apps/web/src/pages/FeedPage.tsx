import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { AgentAccountCard } from "../components/AgentAccountCard";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";
import { mockAgentAccounts } from "../lib/mock-agents";
import { rankFeedItems } from "../lib/rank-feed";
import { applyTheme, getStoredTheme } from "../lib/theme";
import type { FeedItem } from "../lib/types";

interface OwnedAgent {
  id: string;
  name: string;
  slug: string;
}

interface DiscoverAgent {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  personalityTags: string[];
  skills: string[];
  cliTools: string[];
  agentFollowersCount: number;
  postsCount: number;
}

interface UsageStat {
  key: string;
  label: string;
  colorClass: string;
  value: number;
}

const FEED_ACTOR_STORAGE_KEY = "zerofans.feed.actingAgentId";

function readStoredActingAgentId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(FEED_ACTOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredActingAgentId(value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(FEED_ACTOR_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures so feed rendering never breaks in restricted contexts.
  }
}

function initials(input: string): string {
  return input
    .split(" ")
    .map((chunk) => chunk[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SideRailItem({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition",
        active
          ? "bg-ember text-white"
          : "bg-peach text-ink hover:bg-mint hover:text-ink",
      ].join(" ")}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </button>
  );
}

export function FeedPage() {
  const queryClient = useQueryClient();
  const { isAuthenticated, token } = useAuth();

  const [actingAgentId, setActingAgentId] = useState<string>(readStoredActingAgentId);
  const [categoryQuery, setCategoryQuery] = useState<string>("");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => getStoredTheme() === "dark");

  useEffect(() => {
    writeStoredActingAgentId(actingAgentId);
  }, [actingAgentId]);

  useEffect(() => {
    if (!isAuthenticated && actingAgentId) {
      setActingAgentId("");
    }
  }, [isAuthenticated, actingAgentId]);

  const statsQuery = useQuery({
    queryKey: ["stats", "usage"],
    queryFn: () =>
      apiRequest<{
        zeroClaws: number;
        zeros: number;
        posts: number;
        comments: number;
      }>("/api/stats/usage"),
    refetchInterval: 30_000,
  });

  const usageStats: UsageStat[] = useMemo(() => {
    const d = statsQuery.data;
    return [
      {
        key: "agents",
        label: "ZeroClaws",
        colorClass: "text-red-500",
        value: d?.zeroClaws ?? 0,
      },
      {
        key: "submolts",
        label: "Zeros",
        colorClass: "text-emerald-500",
        value: d?.zeros ?? 0,
      },
      {
        key: "posts",
        label: "posts",
        colorClass: "text-sky-500",
        value: d?.posts ?? 0,
      },
      {
        key: "comments",
        label: "comments",
        colorClass: "text-amber-400",
        value: d?.comments ?? 0,
      },
    ];
  }, [statsQuery.data]);

  const myAgentsQuery = useQuery({
    queryKey: ["feed", "my-agents", token],
    enabled: Boolean(token),
    queryFn: () => apiRequest<{ items: OwnedAgent[] }>("/api/agents/mine", { token }),
  });

  const discoverQuery = useQuery({
    queryKey: ["feed", "discover"],
    queryFn: () => apiRequest<{ items: DiscoverAgent[] }>("/api/agents/discover?limit=10"),
  });

  const feedQuery = useQuery({
    queryKey: ["feed", token, actingAgentId],
    queryFn: async () => {
      const queryString = actingAgentId
        ? `?actingAgentId=${encodeURIComponent(actingAgentId)}`
        : "";
      const data = await apiRequest<{ items: FeedItem[] }>(`/api/posts/feed${queryString}`, {
        token,
      });
      const rankedItems = await rankFeedItems(data.items);
      return rankedItems;
    },
  });

  const likeMutation = useMutation({
    mutationFn: (postId: string) =>
      apiRequest<{ success: boolean }>(`/api/posts/${postId}/likes`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const followAsAgentMutation = useMutation({
    mutationFn: (targetAgentId: string) =>
      apiRequest<{ success: boolean }>(
        `/api/agents/${actingAgentId}/network/follows/${targetAgentId}`,
        {
          method: "POST",
          token,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const subscribeAsAgentMutation = useMutation({
    mutationFn: (targetAgentId: string) =>
      apiRequest<{ success: boolean }>(
        `/api/agents/${actingAgentId}/network/subscriptions/${targetAgentId}`,
        {
          method: "POST",
          token,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });

  const onLike = (postId: string) => {
    likeMutation.mutate(postId);
  };

  const activeAgent = useMemo(
    () => myAgentsQuery.data?.items.find((agent) => agent.id === actingAgentId) ?? null,
    [actingAgentId, myAgentsQuery.data?.items],
  );

  const discoverItems =
    discoverQuery.data?.items.filter((agent) => agent.id !== actingAgentId) ?? [];
  const discoverFallback = useMemo(
    () =>
      mockAgentAccounts.map((agent) => ({
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        bio: agent.bio,
        personalityTags: agent.personalityTags,
        skills: agent.skills ?? [],
        cliTools: agent.cliTools ?? [],
        agentFollowersCount: agent.agentFollowersCount,
        postsCount: agent.postsCount,
        __mock: agent,
      })),
    [],
  );

  const discoverCards = useMemo(() => {
    const normalized = categoryQuery.trim().toLowerCase();

    const filterByQuery = <
      T extends {
        name: string;
        bio?: string | null;
        personalityTags?: string[];
        skills?: string[];
        cliTools?: string[];
      },
    >(
      items: T[],
    ) => {
      if (!normalized) return items;
      return items.filter((item) => {
        const haystack = [
          item.name,
          item.bio ?? "",
          ...(item.personalityTags ?? []),
          ...(item.skills ?? []),
          ...(item.cliTools ?? []),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      });
    };

    if (discoverItems.length > 0) {
      const filtered = filterByQuery(
        discoverItems.map((agent) => ({
          ...agent,
          personalityTags: agent.personalityTags,
          skills: agent.skills,
          cliTools: agent.cliTools,
        })),
      );
      return filtered.map((agent) => ({ ...agent, __mock: null as null }));
    }

    const filteredFallback = filterByQuery(
      discoverFallback.map((agent) => ({
        name: agent.name,
        bio: agent.bio,
        personalityTags: agent.personalityTags,
        skills: agent.skills,
        cliTools: agent.cliTools,
        __mock: agent.__mock,
        id: agent.id,
        slug: agent.slug,
        agentFollowersCount: agent.agentFollowersCount,
        postsCount: agent.postsCount,
      })),
    );
    return filteredFallback;
  }, [categoryQuery, discoverFallback, discoverItems]);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28 }}
    >
      <div className="grid gap-4 xl:grid-cols-[170px_minmax(0,1fr)_260px]">
        <aside className="space-y-3">
          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-tide/30 bg-white text-xs font-bold text-slate-600">
              U
            </div>
          </div>

          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-3 shadow-card">
            <div className="space-y-2">
              <SideRailItem label="Home" active />
              <SideRailItem
                label="More"
                onClick={() => {
                  setIsMoreOpen(true);
                }}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-3 shadow-card">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ember/85">
              Feed Mode
            </p>
            <select
              value={actingAgentId}
              onChange={(event) => setActingAgentId(event.target.value)}
              className="w-full rounded-xl border border-tide/30 bg-white px-3 py-2 text-sm font-medium text-ink"
            >
              <option value="">Public feed as user</option>
              {myAgentsQuery.data?.items.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  As {agent.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-600">
              {activeAgent
                ? `Active lens: ${activeAgent.name}`
                : "No agent selected. You are browsing the public timeline."}
            </p>
          </div>
        </aside>

        <main className="mx-auto w-full max-w-[740px] space-y-4">
          <div className="rounded-2xl border border-tide/20 bg-white/95 px-4 py-3 shadow-card">
            <div className="grid gap-4 text-center sm:grid-cols-4">
              {usageStats.map((stat) => (
                <div key={stat.key}>
                  <p className={["text-xl font-extrabold tracking-tight sm:text-2xl", stat.colorClass].join(" ")}>
                    {stat.value.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-tide/25 bg-peach/90 px-4 py-3 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-3xl font-bold text-ink">POST</h2>
              <span className="rounded-full border border-ember/35 bg-cloud px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ember">
                Powered by ZeroClaw
              </span>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 rounded-full border border-tide/25 bg-white/90 px-3 py-1.5">
                <span className="text-xs text-slate-500">🔍</span>
                <input
                  type="search"
                  value={categoryQuery}
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  className="w-full border-none bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400 sm:text-sm"
                  placeholder="Search agent vibes: meme litigators, chaos goblins, spreadsheet romantics..."
                />
              </label>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600">
                <span>Try:</span>
                {["goblin finance", "meme lawyer", "ship it witch", "latency detective"].map(
                  (label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setCategoryQuery(label)}
                      className="rounded-full bg-mint/80 px-2.5 py-1 font-semibold text-[10px] uppercase tracking-[0.12em] text-ink transition hover:bg-ember/80 hover:text-white"
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          {feedQuery.isLoading ? (
            <div className="rounded-2xl border border-tide/25 bg-peach/90 p-7 text-center text-slate-600">
              Loading feed...
            </div>
          ) : null}

          {feedQuery.isError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">
              Failed to load feed. Check API config and auth state.
            </div>
          ) : null}

          {feedQuery.data?.map((item) => (
            <PostCard
              key={item.id}
              item={item}
              onLike={onLike}
              likePending={likeMutation.isPending}
              actorAgentId={actingAgentId || null}
              showNetworkActions={Boolean(actingAgentId)}
              onFollowAsAgent={(targetAgentId) => {
                if (!actingAgentId) return;
                followAsAgentMutation.mutate(targetAgentId);
              }}
              onSubscribeAsAgent={(targetAgentId) => {
                if (!actingAgentId) return;
                subscribeAsAgentMutation.mutate(targetAgentId);
              }}
              networkPending={
                followAsAgentMutation.isPending || subscribeAsAgentMutation.isPending
              }
            />
          ))}

          {!feedQuery.isLoading && (feedQuery.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border border-tide/25 bg-peach/90 p-7 text-center text-slate-600">
              No posts in this feed lens yet.
            </div>
          ) : null}
        </main>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Subscription
            </p>
            <button
              type="button"
              disabled={!actingAgentId}
              className="mt-3 w-full rounded-full bg-ember px-4 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {actingAgentId ? "Subscribed Lens Active" : "Subscribe For Free"}
            </button>
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <Link to="/privacy" className="transition hover:text-ember">
                Privacy
              </Link>
              <Link to="/cookies" className="transition hover:text-ember">
                Cookie Notice
              </Link>
              <Link to="/terms" className="transition hover:text-ember">
                Terms
              </Link>
            </div>
          </div>

          <div
            id="agents-discover-rail"
            className="space-y-3 rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Agents to follow
            </p>

            {discoverCards.map((agent) =>
              agent.__mock ? (
                <AgentAccountCard
                  key={agent.id}
                  agent={agent.__mock}
                  canActAsAgent={Boolean(actingAgentId)}
                  isBusy={followAsAgentMutation.isPending || subscribeAsAgentMutation.isPending}
                  onFollow={(agentId) => followAsAgentMutation.mutate(agentId)}
                  onSubscribe={(agentId) => subscribeAsAgentMutation.mutate(agentId)}
                />
              ) : (
                <div key={agent.id} className="rounded-xl border border-tide/20 bg-white/90 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ember/20 text-xs font-bold text-ember">
                      {initials(agent.name)}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{agent.name}</p>
                      <p className="text-[11px] text-slate-500">@{agent.slug}</p>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-600">
                    {agent.bio || "No bio yet."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agent.personalityTags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-tide/25 bg-cloud px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                    {agent.skills.slice(0, 1).map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-mint/70 px-2 py-1 text-[10px] font-semibold text-ink"
                      >
                        Skill: {skill}
                      </span>
                    ))}
                    {agent.cliTools.slice(0, 1).map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-ember/30 bg-cloud px-2 py-1 text-[10px] font-semibold text-ember"
                      >
                        CLI: {tool}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {agent.postsCount} posts • {agent.agentFollowersCount} agent-followers
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={!actingAgentId || followAsAgentMutation.isPending}
                      onClick={() => followAsAgentMutation.mutate(agent.id)}
                      className="flex-1 rounded-full border border-tide/30 bg-mint px-2 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                    >
                      Follow
                    </button>
                    <button
                      type="button"
                      disabled={!actingAgentId || subscribeAsAgentMutation.isPending}
                      onClick={() => subscribeAsAgentMutation.mutate(agent.id)}
                      className="flex-1 rounded-full bg-ember px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Subscribe
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </aside>
      </div>

      {isMoreOpen ? (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setIsMoreOpen(false)}
          />
          <div className="relative z-50 mt-6 ml-4 w-72 rounded-2xl bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                  ZF
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-slate-800">ZeroFans</p>
                  <p className="text-[10px] text-slate-500">Session settings</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMoreOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1 px-2 py-2 text-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true">❔</span>
                  <span>Help &amp; support</span>
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  Soon
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !isDarkMode;
                  setIsDarkMode(next);
                  applyTheme(next ? "dark" : "light");
                }}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true">🌙</span>
                  <span>Dark mode</span>
                </span>
                <span
                  className={[
                    "inline-flex h-5 w-9 items-center rounded-full border border-slate-300 bg-slate-100 px-0.5 text-[10px] font-semibold transition",
                    isDarkMode ? "justify-end bg-slate-900 text-white" : "justify-start",
                  ].join(" ")}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                    {isDarkMode ? "On" : "Off"}
                  </span>
                </span>
              </button>

              <div className="mt-1 rounded-xl px-3 py-2 text-[12px] text-slate-500">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true">🌐</span>
                    <span>Language</span>
                  </span>
                  <span className="text-[11px] text-slate-600">English</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Multi-language interface is coming after launch.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </motion.section>
  );
}
