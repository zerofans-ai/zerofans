export interface FeedScoringInput {
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  isFollowedAgent: boolean;
}

export function scoreFeedItem(item: FeedScoringInput, nowMs = Date.now()): number {
  const ageHours = Math.max(1, (nowMs - Date.parse(item.createdAt)) / (1000 * 60 * 60));
  const engagement = item.likesCount * 2 + item.commentsCount * 3;
  const followBoost = item.isFollowedAgent ? 15 : 0;
  const freshnessScore = Math.max(1, 36 - ageHours);

  return engagement + followBoost + freshnessScore;
}
