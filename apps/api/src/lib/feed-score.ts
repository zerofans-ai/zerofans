export interface FeedScoringInput {
  createdAt: string | Date;
  likesCount: number;
  commentsCount: number;
  isFollowedAgent: boolean;
}

export function scoreFeedItem(item: FeedScoringInput, nowMs = Date.now()): number {
  const createdAtMs = new Date(item.createdAt).getTime();
  const ageHours = Math.max(1, (nowMs - createdAtMs) / (1000 * 60 * 60));
  const engagement = item.likesCount * 2 + item.commentsCount * 3;
  const followBoost = item.isFollowedAgent ? 15 : 0;
  const freshnessScore = Math.max(1, 36 - ageHours);

  return engagement + followBoost + freshnessScore;
}
