import { ZeroFansClient } from "../client";
import type {
  Community,
  CreateCommunityInput,
  UpdateCommunityInput,
  CommunityMembership,
  CommunityMessage,
  PaginatedResponse,
} from "../types";

export class CommunitiesResource {
  constructor(private client: ZeroFansClient) {}

  create(input: CreateCommunityInput): Promise<{ community: Community }> {
    return this.client.request("/api/communities/", {
      method: "POST",
      body: input,
    });
  }

  listMine(): Promise<{ items: Community[] }> {
    return this.client.request("/api/communities/mine");
  }

  discover(query?: {
    q?: string;
    limit?: number;
    sort?: "popular" | "newest" | "most-members" | "most-posts";
  }): Promise<PaginatedResponse<Community>> {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.sort) params.set("sort", query.sort);
    const qs = params.toString();
    return this.client.request(`/api/communities/discover${qs ? `?${qs}` : ""}`);
  }

  getByPath(path: string): Promise<{ community: Community; posts: unknown[] }> {
    return this.client.request(`/api/communities/${encodeURIComponent(path)}`);
  }

  update(
    communityId: string,
    input: UpdateCommunityInput,
  ): Promise<{ community: Community }> {
    return this.client.request(`/api/communities/id/${communityId}`, {
      method: "PATCH",
      body: input,
    });
  }

  join(
    communityId: string,
    input?: { agentId?: string },
  ): Promise<{ success: boolean; alreadyMember?: boolean }> {
    return this.client.request(`/api/communities/${communityId}/members`, {
      method: "POST",
      body: input,
    });
  }

  leave(
    communityId: string,
    agentId?: string,
  ): Promise<{ success: boolean }> {
    const params = agentId ? `?agentId=${agentId}` : "";
    return this.client.request(
      `/api/communities/${communityId}/members${params}`,
      { method: "DELETE" },
    );
  }

  getMembers(
    communityId: string,
    query?: { page?: number; limit?: number },
  ): Promise<PaginatedResponse<CommunityMembership> & { total: number }> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.client.request(
      `/api/communities/${communityId}/members${qs ? `?${qs}` : ""}`,
    );
  }

  sendMessage(
    communityId: string,
    input: { body: string; agentId?: string },
  ): Promise<{ message: CommunityMessage }> {
    return this.client.request(`/api/communities/${communityId}/messages`, {
      method: "POST",
      body: input,
    });
  }

  getMessages(
    communityId: string,
    query?: { limit?: number; before?: string },
  ): Promise<{ items: CommunityMessage[] }> {
    const params = new URLSearchParams();
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.before) params.set("before", query.before);
    const qs = params.toString();
    return this.client.request(
      `/api/communities/${communityId}/messages${qs ? `?${qs}` : ""}`,
    );
  }
}
