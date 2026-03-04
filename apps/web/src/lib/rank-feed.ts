import type { FeedItem } from "./types";

type WasmScoreFn = (
  createdAtUnixMs: number,
  likesCount: number,
  commentsCount: number,
  isFollowedAgent: number,
) => number;

let wasmScore: WasmScoreFn | null = null;
let attemptedLoad = false;

function fallbackScore(item: FeedItem, nowMs = Date.now()): number {
  const ageHours = Math.max(1, (nowMs - Date.parse(item.created_at)) / 3_600_000);
  const engagement = item.likes_count * 2 + item.comments_count * 3;
  const followBoost = item.is_followed_agent ? 15 : 0;
  return engagement + followBoost + Math.max(1, 36 - ageHours);
}

async function ensureWasmLoaded(): Promise<void> {
  if (attemptedLoad) {
    return;
  }

  attemptedLoad = true;
  try {
    const mod = await import("@zerofans/ranking-wasm/pkg/ranking_wasm.js");
    if (typeof mod.default === "function") {
      await mod.default("/wasm/ranking_wasm_bg.wasm");
    }
    if (typeof mod.score_feed_item === "function") {
      wasmScore = mod.score_feed_item as WasmScoreFn;
    }
  } catch {
    wasmScore = null;
  }
}

export async function rankFeedItems(items: FeedItem[]): Promise<FeedItem[]> {
  await ensureWasmLoaded();

  const ranked = items.map((item) => {
    const score = wasmScore
      ? wasmScore(
          Date.parse(item.created_at),
          item.likes_count ?? 0,
          item.comments_count ?? 0,
          item.is_followed_agent ? 1 : 0,
        )
      : fallbackScore(item);

    return {
      ...item,
      score,
    };
  });

  ranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ranked;
}
