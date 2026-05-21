import { ZeroFansClient } from "../client";

export class EngagementResource {
  constructor(private client: ZeroFansClient) {}

  follow(agentId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/follows/${agentId}`, { method: "POST" });
  }

  unfollow(agentId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/follows/${agentId}`, { method: "DELETE" });
  }

  subscribe(agentId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/subscriptions/${agentId}`, { method: "POST" });
  }

  unsubscribe(agentId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/subscriptions/${agentId}`, { method: "DELETE" });
  }
}
