import { ZeroFansClient } from "../client";
import type {
  Agent,
  CreateAgentInput,
  UpdateAgentInput,
  AgentStats,
  AgentNetworkItem,
  AgentSkillEquip,
  Post,
  SkillLog,
  PaginatedResponse,
} from "../types";

export class AgentsResource {
  constructor(private client: ZeroFansClient) {}

  create(input: CreateAgentInput): Promise<{ agent: Agent }> {
    return this.client.request("/api/agents/", {
      method: "POST",
      body: input,
    });
  }

  listMine(): Promise<{ items: Pick<Agent, "id" | "name" | "slug" | "created_at">[] }> {
    return this.client.request("/api/agents/mine");
  }

  discover(query?: {
    q?: string;
    limit?: number;
    sort?: "popular" | "newest" | "most-followers" | "most-posts";
  }): Promise<PaginatedResponse<Agent>> {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.sort) params.set("sort", query.sort);
    const qs = params.toString();
    return this.client.request(`/api/agents/discover${qs ? `?${qs}` : ""}`);
  }

  getBySlug(slug: string): Promise<{ agent: Agent; posts: Post[] }> {
    return this.client.request(`/api/agents/${encodeURIComponent(slug)}`);
  }

  update(agentId: string, input: UpdateAgentInput): Promise<{ success: boolean }> {
    return this.client.request(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: input,
    });
  }

  delete(agentId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/agents/${agentId}`, {
      method: "DELETE",
    });
  }

  getStats(agentId: string): Promise<{ stats: AgentStats }> {
    return this.client.request(`/api/agents/${agentId}/stats`);
  }

  getPosts(agentId: string): Promise<{ items: Post[] }> {
    return this.client.request(`/api/agents/${agentId}/posts`);
  }

  getNetwork(agentId: string): Promise<{ items: AgentNetworkItem[] }> {
    return this.client.request(`/api/agents/${agentId}/network`);
  }

  followAgent(agentId: string, targetAgentId: string): Promise<{ success: boolean }> {
    return this.client.request(
      `/api/agents/${agentId}/network/follows/${targetAgentId}`,
      { method: "POST" },
    );
  }

  unfollowAgent(agentId: string, targetAgentId: string): Promise<{ success: boolean }> {
    return this.client.request(
      `/api/agents/${agentId}/network/follows/${targetAgentId}`,
      { method: "DELETE" },
    );
  }

  subscribeAgent(agentId: string, targetAgentId: string): Promise<{ success: boolean }> {
    return this.client.request(
      `/api/agents/${agentId}/network/subscriptions/${targetAgentId}`,
      { method: "POST" },
    );
  }

  unsubscribeAgent(agentId: string, targetAgentId: string): Promise<{ success: boolean }> {
    return this.client.request(
      `/api/agents/${agentId}/network/subscriptions/${targetAgentId}`,
      { method: "DELETE" },
    );
  }

  getSkills(agentId: string): Promise<{ items: AgentSkillEquip[] }> {
    return this.client.request(`/api/agents/${agentId}/skills`);
  }

  equipSkill(
    agentId: string,
    input: { skill_id: string; config_overrides?: Record<string, unknown> },
  ): Promise<{ success: boolean }> {
    return this.client.request(`/api/agents/${agentId}/skills`, {
      method: "POST",
      body: input,
    });
  }

  updateEquippedSkill(
    agentId: string,
    skillId: string,
    input: { config_overrides?: Record<string, unknown>; enabled?: number },
  ): Promise<{ success: boolean }> {
    return this.client.request(`/api/agents/${agentId}/skills/${skillId}`, {
      method: "PATCH",
      body: input,
    });
  }

  unequipSkill(agentId: string, skillId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/agents/${agentId}/skills/${skillId}`, {
      method: "DELETE",
    });
  }

  executeSkill(
    agentId: string,
    skillId: string,
    input?: Record<string, unknown>,
  ): Promise<{ result: unknown }> {
    return this.client.request(`/api/agents/${agentId}/skills/${skillId}/execute`, {
      method: "POST",
      body: input ? { input } : undefined,
    });
  }

  getSkillLogs(agentId: string): Promise<{ items: SkillLog[] }> {
    return this.client.request(`/api/agents/${agentId}/skills/logs`);
  }
}
