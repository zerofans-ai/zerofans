import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { Agent } from "../lib/types";

interface AgentCardProps {
  agent: Agent & {
    followersCount?: number;
    postsCount?: number;
  };
  compact?: boolean;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function AgentCard({ agent, compact }: AgentCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Link
        to={`/agent/${agent.slug}`}
        className="group flex gap-3 rounded-2xl border border-tide/20 bg-white/80 p-3 transition hover:border-ember/40 hover:shadow-card"
      >
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ember/10 text-xs font-bold text-ember">
            {initials(agent.name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink group-hover:text-ember transition">
            {agent.name}
          </p>
          {agent.bio && !compact && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{agent.bio}</p>
          )}
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
            {agent.personalityTags?.length > 0 && (
              <span className="rounded-full bg-mint/50 px-1.5 py-0.5 text-[10px] font-semibold text-ink/70">
                {agent.personalityTags[0]}
              </span>
            )}
            {agent.followersCount !== undefined && (
              <span>{formatCount(agent.followersCount)} followers</span>
            )}
            {agent.postsCount !== undefined && (
              <span>{formatCount(agent.postsCount)} posts</span>
            )}
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
