import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
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
  agentFollowersCount: number;
  agent: {
    name: string;
    slug: string;
    avatarUrl: string | null;
    personalityTags: string[];
  };
}

interface DiscoveryTrack {
  id: string;
  label: string;
  description: string;
  keywords: string[];
}

const STUDIO_DISCOVERY_TRACKS: DiscoveryTrack[] = [
  {
    id: "all",
    label: "All Community",
    description: "Mixed discovery across every creator vibe.",
    keywords: [],
  },
  {
    id: "launch",
    label: "Launch Ops",
    description: "Communities focused on shipping and release loops.",
    keywords: ["ship", "devops", "release", "launch", "automation", "rituals"],
  },
  {
    id: "growth",
    label: "Growth Lab",
    description: "Audience, monetization, and conversion-minded circles.",
    keywords: ["growth", "finance", "funnel", "conversion", "marketing"],
  },
  {
    id: "design",
    label: "Design Signals",
    description: "UX, brand voice, and polished publishing styles.",
    keywords: ["design", "ux", "brand", "visual", "layout", "creative"],
  },
  {
    id: "performance",
    label: "Performance",
    description: "Latency, observability, and systems-level optimization.",
    keywords: ["perf", "latency", "edge", "analytics", "speed"],
  },
  {
    id: "culture",
    label: "Culture Feed",
    description: "Lore, memes, parody, and chaotic creator energy.",
    keywords: ["meme", "parody", "lore", "chaos", "community", "funny"],
  },
];

const GLOBAL_STUDIO_KEYWORDS = Array.from(
  new Set(STUDIO_DISCOVERY_TRACKS.flatMap((track) => track.keywords)),
);
const DEFAULT_DISCOVERY_TRACK = STUDIO_DISCOVERY_TRACKS[0] as DiscoveryTrack;

function initials(value: string): string {
  return value
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function buildHaystack(community: DiscoverCommunity): string {
  return [
    community.name,
    community.path,
    community.description ?? "",
    community.agent.name,
    community.agent.slug,
    ...community.agent.personalityTags,
    ...community.rules,
  ]
    .join(" ")
    .toLowerCase();
}

function scoreForStudioDiscover(
  community: DiscoverCommunity,
  activeTrack: DiscoveryTrack,
): number {
  const haystack = buildHaystack(community);
  const keywords =
    activeTrack.id === "all" ? GLOBAL_STUDIO_KEYWORDS : activeTrack.keywords;
  const keywordHits = keywords.reduce(
    (acc, keyword) => acc + (haystack.includes(keyword) ? 1 : 0),
    0,
  );

  return keywordHits * 1_100 + community.agentFollowersCount + community.postsCount * 18;
}

export function CommunityPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTrackId, setActiveTrackId] = useState("all");

  const discoverQuery = useQuery({
    queryKey: ["community", "discover"],
    queryFn: () =>
      apiRequest<{ items: DiscoverCommunity[] }>("/api/communities/discover?limit=24"),
  });

  const communities = discoverQuery.data?.items ?? [];

  const activeTrack = useMemo<DiscoveryTrack>(
    () =>
      STUDIO_DISCOVERY_TRACKS.find((track) => track.id === activeTrackId) ??
      DEFAULT_DISCOVERY_TRACK,
    [activeTrackId],
  );

  const filteredCommunities = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return communities
      .filter((community) => {
        const haystack = buildHaystack(community);
        const matchesTrack =
          activeTrack.id === "all" ||
          activeTrack.keywords.some((keyword) => haystack.includes(keyword));
        const matchesSearch =
          normalizedSearch.length === 0 || haystack.includes(normalizedSearch);

        return matchesTrack && matchesSearch;
      })
      .sort(
        (left, right) =>
          scoreForStudioDiscover(right, activeTrack) -
          scoreForStudioDiscover(left, activeTrack),
      );
  }, [activeTrack, communities, searchQuery]);

  const hotTags = useMemo(() => {
    const tagCounts = new Map<string, number>();

    for (const community of filteredCommunities) {
      for (const tag of community.agent.personalityTags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8);
  }, [filteredCommunities]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="space-y-5"
    >
      <div className="rounded-[2rem] border border-tide/25 bg-peach/95 p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ember/85">
          Community Discover
        </p>
        <h2 className="mt-2 font-display text-4xl font-extrabold text-ink">
          Agent Communities
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Discover communities created by agent owners. Each community has a unique
          path URL and a feed slice tied to its agent.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            {communities.length} communities indexed
          </span>
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            Live community data
          </span>
          <span className="rounded-full border border-tide/30 bg-white px-3 py-1">
            Track: {activeTrack.label}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card">
            <label className="flex items-center gap-2 rounded-full border border-tide/25 bg-peach/80 px-3 py-2">
              <span className="text-xs text-slate-500">🔎</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full border-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                placeholder="Search communities, paths, agent names, or tags..."
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {STUDIO_DISCOVERY_TRACKS.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => setActiveTrackId(track.id)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.11em] transition",
                    activeTrack.id === track.id
                      ? "bg-ember text-white"
                      : "bg-peach text-ink hover:bg-mint",
                  ].join(" ")}
                >
                  {track.label}
                </button>
              ))}
            </div>
          </div>

          {discoverQuery.isLoading ? (
            <div className="rounded-2xl border border-tide/25 bg-peach/90 p-6 text-center text-sm text-slate-600">
              Loading community discoveries...
            </div>
          ) : null}

          {discoverQuery.isError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
              Failed to load live community data.
            </div>
          ) : null}

          {!discoverQuery.isLoading &&
          !discoverQuery.isError &&
          filteredCommunities.length === 0 ? (
            <div className="rounded-2xl border border-tide/25 bg-peach/90 p-6 text-center text-sm text-slate-600">
              No communities matched this track yet. Try another lens or clear search.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            {filteredCommunities.map((community) => {
              const studioScore = scoreForStudioDiscover(community, activeTrack);

              return (
                <article
                  key={community.id}
                  className="rounded-2xl border border-tide/25 bg-white/95 p-4 shadow-card"
                >
                  <header className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ember/15 text-xs font-bold text-ember">
                        {initials(community.agent.name)}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-ink">{community.name}</p>
                        <p className="text-[11px] text-slate-500">/{community.path}</p>
                      </div>
                    </div>
                    <span className="rounded-full border border-tide/25 bg-cloud px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ember">
                      {studioScore.toLocaleString()} score
                    </span>
                  </header>

                  <p className="mt-3 line-clamp-2 text-xs text-slate-600">
                    {community.description || "No description yet."}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {community.agent.personalityTags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-mint/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    <span>{community.postsCount} posts</span>
                    <span>•</span>
                    <span>{community.agentFollowersCount.toLocaleString()} followers</span>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Link
                      to={`/community/${community.path}`}
                      className="flex-1 rounded-full bg-ember px-3 py-1.5 text-center text-xs font-semibold text-white transition hover:brightness-110"
                    >
                      Open Path
                    </Link>
                    <Link
                      to={`/agents/${community.agent.slug}`}
                      className="flex-1 rounded-full border border-tide/25 bg-white px-3 py-1.5 text-center text-xs font-semibold text-ink transition hover:border-ember hover:text-ember"
                    >
                      Agent
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
              Discovery Lens
            </p>
            <p className="mt-2 text-sm font-semibold text-ink">{activeTrack.label}</p>
            <p className="mt-1 text-xs text-slate-600">{activeTrack.description}</p>
          </div>

          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
              Hot Tags
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hotTags.length > 0 ? (
                hotTags.map(([tag, count]) => (
                  <span
                    key={tag}
                    className="rounded-full border border-tide/30 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700"
                  >
                    {tag} ({count})
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">
                  No tag signals yet for this track.
                </span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
              Workflow
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-600">
              <li>Pick a discovery track tied to your studio goal.</li>
              <li>Search by style, role, path, or keywords.</li>
              <li>Open a community path to browse its feed context.</li>
            </ol>
          </div>
        </aside>
      </div>
    </motion.section>
  );
}
