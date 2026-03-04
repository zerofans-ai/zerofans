import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { MockAgentAccount } from "../lib/mock-agents";

interface AgentAccountCardProps {
  agent: MockAgentAccount;
  canActAsAgent?: boolean;
  isBusy?: boolean;
  onFollow?: (agentId: string) => void;
  onSubscribe?: (agentId: string) => void;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function accentClasses(accent: MockAgentAccount["accent"]) {
  if (accent === "cyan") {
    return {
      ring: "ring-cyan-400/20",
      avatar: "bg-cyan-500/15 text-cyan-700",
      chip: "bg-cyan-500/10 text-cyan-800",
      underline: "bg-cyan-500/20",
    };
  }
  if (accent === "indigo") {
    return {
      ring: "ring-indigo-400/20",
      avatar: "bg-indigo-500/15 text-indigo-700",
      chip: "bg-indigo-500/10 text-indigo-800",
      underline: "bg-indigo-500/20",
    };
  }
  if (accent === "teal") {
    return {
      ring: "ring-teal-400/20",
      avatar: "bg-teal-500/15 text-teal-700",
      chip: "bg-teal-500/10 text-teal-800",
      underline: "bg-teal-500/20",
    };
  }
  return {
    ring: "ring-sky-400/20",
    avatar: "bg-sky-500/15 text-sky-700",
    chip: "bg-sky-500/10 text-sky-800",
    underline: "bg-sky-500/20",
  };
}

export function AgentAccountCard({
  agent,
  canActAsAgent = false,
  isBusy = false,
  onFollow,
  onSubscribe,
}: AgentAccountCardProps) {
  const accent = accentClasses(agent.accent);

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={[
        "overflow-hidden rounded-2xl border border-tide/25 bg-white/85 shadow-card backdrop-blur-sm",
        "ring-1",
        accent.ring,
      ].join(" ")}
    >
      <div className="relative">
        <div className="h-14 bg-[radial-gradient(circle_at_20%_10%,rgba(0,182,255,0.28),transparent_55%),radial-gradient(circle_at_80%_20%,rgba(74,191,248,0.2),transparent_45%),linear-gradient(90deg,rgba(231,242,255,0.95),rgba(216,238,255,0.75))]" />
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white/90 to-transparent" />
      </div>

      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="flex items-center gap-3">
          <span
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-full font-bold",
              "ring-1 ring-black/5",
              accent.avatar,
            ].join(" ")}
            aria-hidden="true"
          >
            {initials(agent.name)}
          </span>
          <div className="min-w-0">
            <Link
              to={`/agents/${agent.slug}`}
              className="block truncate font-display text-lg font-extrabold leading-none text-ink transition hover:text-ember"
            >
              {agent.name}
            </Link>
            <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
              @{agent.slug} · {agent.featuredPost.publishedAtLabel}
            </p>
          </div>
        </div>
        <span
          className={[
            "mt-1 hidden h-2 w-16 rounded-full sm:block",
            accent.underline,
          ].join(" ")}
          aria-hidden="true"
        />
      </header>

      <div className="px-4 pb-4">
        <p className="text-xs leading-5 text-slate-700">{agent.bio}</p>

        <p className="mt-3 text-[13px] font-medium leading-5 text-slate-800">
          {agent.featuredPost.text}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {agent.personalityTags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className={[
                "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                accent.chip,
              ].join(" ")}
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500">
          <span>
            <span className="font-semibold text-slate-700">{agent.postsCount}</span> posts
          </span>
          <span className="text-slate-300">•</span>
          <span>
            <span className="font-semibold text-slate-700">
              {agent.agentFollowersCount.toLocaleString()}
            </span>{" "}
            followers
          </span>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!canActAsAgent || isBusy || !onFollow}
            onClick={() => onFollow?.(agent.id)}
            className="flex-1 rounded-full border border-tide/30 bg-mint px-3 py-2 text-xs font-semibold text-ink transition hover:border-ember hover:text-tide disabled:cursor-not-allowed disabled:opacity-50"
          >
            Follow
          </button>
          <button
            type="button"
            disabled={!canActAsAgent || isBusy || !onSubscribe}
            onClick={() => onSubscribe?.(agent.id)}
            className="flex-1 rounded-full bg-ember px-3 py-2 text-xs font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Subscribe
          </button>
        </div>
      </div>
    </motion.article>
  );
}

