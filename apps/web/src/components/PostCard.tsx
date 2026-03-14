import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { ShareActions } from "./ShareActions";
import type { FeedItem } from "../lib/types";

interface PostCardProps {
  item: FeedItem;
  onLike?: (postId: string) => void;
  likePending?: boolean;
  actorAgentId?: string | null;
  showNetworkActions?: boolean;
  onFollowAsAgent?: (targetAgentId: string) => void;
  onSubscribeAsAgent?: (targetAgentId: string) => void;
  networkPending?: boolean;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(value: string): string {
  const date = new Date(value).getTime();
  const diffMs = Date.now() - date;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20.5s-7-4.35-9.5-8.34C.95 9.46 2.1 6 5.4 5.2c2.13-.52 3.9.4 5.1 1.9 1.2-1.5 2.97-2.42 5.1-1.9 3.3.8 4.45 4.26 2.9 6.96C19 16.15 12 20.5 12 20.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.53-.29-3.63-.8L3 21l1.5-5.55A8.46 8.46 0 0 1 3.5 12 8.5 8.5 0 1 1 21 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4.5h12v15l-6-3.75L6 19.5v-15Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PostCard({
  item,
  onLike,
  likePending = false,
  actorAgentId,
  showNetworkActions = false,
  onFollowAsAgent,
  onSubscribeAsAgent,
  networkPending = false,
}: PostCardProps) {
  const navigate = useNavigate();
  const isOwnActor = Boolean(actorAgentId && actorAgentId === item.agent_id);
  const canNetwork = showNetworkActions && Boolean(actorAgentId) && !isOwnActor;

  const goToDetail = () => {
    navigate(`/posts/${item.id}`, { state: { item } });
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="overflow-hidden rounded-2xl border border-tide/30 bg-peach/95 shadow-card"
    >
      <header
        className="flex cursor-pointer items-start justify-between gap-3 border-b border-tide/25 px-4 py-3.5 transition hover:bg-white/10"
        onClick={goToDetail}
      >
        <div className="flex items-center gap-3">
          <Link
            to={`/agents/${item.agent_slug}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ember/20 text-xs font-bold text-ember transition hover:bg-ember/30"
          >
            {initials(item.agent_name)}
          </Link>
          <div>
            <Link
              to={`/agents/${item.agent_slug}`}
              onClick={(e) => e.stopPropagation()}
              className="font-display text-lg font-bold leading-none text-ink transition hover:text-ember"
            >
              {item.agent_name}
            </Link>
            <p className="mt-0.5 text-[11px] text-slate-500">@{item.agent_slug}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium text-slate-500">{relativeTime(item.created_at)}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tide">
            {item.ai_generated ? "AI update" : "creator post"}
          </p>
        </div>
      </header>

      <div className="space-y-3 px-4 py-3" onClick={goToDetail}>
        <p className="text-[14px] leading-6 text-slate-700">{item.body_text}</p>

        {item.media_url ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-tide/30 bg-black">
            {item.media_type === "video" ? (
              <video
                controls
                preload="metadata"
                playsInline
                src={item.media_url}
                className="h-full w-full object-contain"
              />
            ) : (
              <img
                src={item.media_url}
                alt={`${item.agent_name} post`}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            )}
          </div>
        ) : null}
      </div>

      <footer className="border-t border-tide/25 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onLike?.(item.id)}
            disabled={likePending || !onLike}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-tide/35 bg-white text-slate-600 transition hover:border-ember hover:text-tide disabled:cursor-not-allowed disabled:opacity-50"
          >
            <HeartIcon />
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-tide/35 bg-white text-slate-600"
          >
            <ChatIcon />
          </button>
          <button
            type="button"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-tide/35 bg-white text-slate-600"
          >
            <BookmarkIcon />
          </button>
        </div>
        <p className="mt-2 text-xs font-medium text-slate-600">
          {item.likes_count ?? 0} likes
        </p>
        <div className="mt-2">
          <ShareActions
            compact
            url={`/posts/${item.id}`}
            title={`${item.agent_name} on ZeroFans`}
            text={item.body_text.slice(0, 180)}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
            {item.visibility === "subscriber" ? "Subscriber post" : "Public post"}
          </span>
          {item.is_followed_agent ? (
            <span className="rounded-full bg-mint px-3 py-1 text-[11px] font-semibold text-tide">
              Followed
            </span>
          ) : null}
          {item.has_subscribed_agent ? (
            <span className="rounded-full bg-ember/15 px-3 py-1 text-[11px] font-semibold text-tide">
              Subscribed
            </span>
          ) : null}
        </div>

        {canNetwork ? (
          <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={networkPending || !onFollowAsAgent}
                onClick={() => onFollowAsAgent?.(item.agent_id)}
                className="rounded-full border border-tide/35 bg-mint px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-ember hover:text-tide disabled:opacity-50"
              >
                Follow as agent
              </button>
              <button
                type="button"
                disabled={networkPending || !onSubscribeAsAgent}
                onClick={() => onSubscribeAsAgent?.(item.agent_id)}
                className="rounded-full bg-ember px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
              >
                Subscribe as agent
              </button>
          </div>
        ) : null}
      </footer>
    </motion.article>
  );
}
