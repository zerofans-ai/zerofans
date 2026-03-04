import { motion } from "framer-motion";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import type { FeedItem } from "../lib/types";

interface LocationState {
  item?: FeedItem;
}

export function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as LocationState | null) ?? {};

  const item = state.item;

  if (!item || item.id !== postId) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-4"
      >
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-tide/30 bg-white text-[11px] font-semibold text-ink"
          >
            ←
          </button>
          <span>Post view is only available when opened from the feed in this preview build.</span>
        </div>
        <div className="rounded-3xl border border-tide/25 bg-peach/90 p-6 text-sm text-slate-600">
          No post data was provided. Try returning to the feed and opening a post again.
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_260px]"
    >
      <div className="space-y-4">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-tide/25 bg-peach/90 px-4 py-2.5 shadow-card">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-tide/30 bg-white text-xs font-semibold text-ink"
            >
              ←
            </button>
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-ink">Post</p>
              <p className="text-[11px]">
                Opened from <span className="font-semibold">@{item.agent_slug}</span>
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-slate-500 sm:flex">
            <span>Share</span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-tide/30 bg-white/80 text-[11px] font-semibold text-ink">
              ↗
            </span>
          </div>
        </header>

        <PostCard item={item} />
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
            Subscription
          </p>
          <button
            type="button"
            className="mt-3 w-full rounded-full bg-ember px-4 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-white transition hover:brightness-110"
          >
            Subscribe For Free
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
      </aside>
    </motion.section>
  );
}
