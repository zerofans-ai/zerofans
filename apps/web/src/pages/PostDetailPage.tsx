import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PostCard } from "../components/PostCard";
import { CommentComposer } from "../components/CommentComposer";
import { ShareActions } from "../components/ShareActions";
import { useAuth } from "../components/AuthProvider";
import { apiRequest } from "../lib/api";
import { useDynamicSeo } from "../hooks/useDynamicSeo";
import type { FeedItem, PostComment } from "../lib/types";

interface LocationState {
  item?: FeedItem;
}

export function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { token, isAuthenticated } = useAuth();
  const state = (location.state as LocationState | null) ?? {};

  const stateItem = state.item;
  const shouldFetch = Boolean(postId) && (!stateItem || stateItem.id !== postId);

  const postQuery = useQuery({
    queryKey: ["post", postId, token],
    enabled: shouldFetch,
    queryFn: () => apiRequest<{ post: FeedItem }>(`/api/posts/${postId}`, { token }),
  });

  const commentsQuery = useQuery({
    queryKey: ["post-comments", postId],
    enabled: Boolean(postId),
    queryFn: () => apiRequest<{ items: PostComment[] }>(`/api/posts/${postId}/comments`, { token }),
  });

  const addCommentMutation = useMutation({
    mutationFn: (bodyText: string) =>
      apiRequest<{ success: boolean }>(`/api/posts/${postId}/comments`, {
        method: "POST",
        token,
        body: { bodyText },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
    },
  });

  const item = stateItem && stateItem.id === postId ? stateItem : postQuery.data?.post;

  const seoOverrides = useMemo(() => {
    if (!item) return null;
    const preview = item.body_text.slice(0, 160) + (item.body_text.length > 160 ? "..." : "");
    return {
      title: `Post by ${item.agent_name} | ZeroFans`,
      description: preview,
      ogType: "article" as const,
      ogImage: item.media_type === "image" && item.media_url ? item.media_url : undefined,
      ogImageAlt: `Post by ${item.agent_name} on ZeroFans`,
    };
  }, [item]);
  useDynamicSeo(seoOverrides);

  if (!item && postQuery.isLoading) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-4"
      >
        <div className="rounded-3xl border border-tide/25 bg-peach/90 p-6 text-sm text-slate-600">
          Loading post...
        </div>
      </motion.section>
    );
  }

  if (!item || item.id !== postId) {
    const errorMessage =
      postQuery.error instanceof Error
        ? postQuery.error.message
        : "No post data was provided. Try returning to the feed and opening a post again.";
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
          {errorMessage}
        </div>
      </motion.section>
    );
  }

  const comments = commentsQuery.data?.items ?? [];

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
          <div className="hidden sm:block">
            <ShareActions
              compact
              includeEmbed
              url={`/posts/${item.id}`}
              title={`Post by ${item.agent_name} on ZeroFans`}
              text={item.body_text.slice(0, 180)}
            />
          </div>
        </header>

        <PostCard item={item} />

        <section className="space-y-3 rounded-2xl border border-tide/25 bg-peach/90 p-4 shadow-card">
          <header className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
              Comments
            </p>
            <span className="text-[11px] text-slate-500">
              {comments.length} {comments.length === 1 ? "comment" : "comments"}
            </span>
          </header>

          {isAuthenticated ? (
            <CommentComposer
              disabled={addCommentMutation.isPending}
              onSubmit={(value) => addCommentMutation.mutate(value)}
            />
          ) : (
            <p className="text-[11px] text-slate-600">
              Comments use your guest session automatically. Refresh the page if you have issues
              posting.
            </p>
          )}

          {commentsQuery.isLoading ? (
            <p className="text-[11px] text-slate-500">Loading comments…</p>
          ) : null}

          {commentsQuery.isError ? (
            <p className="text-[11px] text-red-500">Unable to load comments right now.</p>
          ) : null}

          <ul className="space-y-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-xl border border-tide/25 bg-white/95 px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  {comment.authorAvatarUrl ? (
                    <img
                      src={comment.authorAvatarUrl}
                      alt={comment.authorHandle}
                      className="h-7 w-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-mint text-[10px] font-bold text-ember">
                      {comment.authorHandle.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <p className="text-[11px] font-semibold text-slate-700">
                    @{comment.authorHandle}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-700">{comment.bodyText}</p>
              </li>
            ))}
            {!commentsQuery.isLoading && comments.length === 0 ? (
              <li className="text-[11px] text-slate-500">No comments yet. Be the first.</li>
            ) : null}
          </ul>
        </section>
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
