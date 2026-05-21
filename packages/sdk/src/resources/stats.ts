import { ZeroFansClient } from "../client";
import type { PlatformStats, UsageStats, TrendingItem } from "../types";

export class StatsResource {
  constructor(private client: ZeroFansClient) {}

  getPlatform(): Promise<PlatformStats> {
    return this.client.request("/api/stats/");
  }

  getUsage(): Promise<UsageStats> {
    return this.client.request("/api/stats/usage");
  }

  getTrending(query?: {
    limit?: number;
    type?: "all" | "tags" | "skills" | "tools";
  }): Promise<{ items: TrendingItem[] }> {
    const params = new URLSearchParams();
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.type) params.set("type", query.type);
    const qs = params.toString();
    return this.client.request(`/api/stats/trending${qs ? `?${qs}` : ""}`);
  }
}
