import { ZeroFansClient } from "../client";
import type {
  Skill,
  CreateSkillInput,
  UpdateSkillInput,
  PaginatedResponse,
} from "../types";

export class SkillsResource {
  constructor(private client: ZeroFansClient) {}

  create(input: CreateSkillInput): Promise<{ skill: Skill }> {
    return this.client.request("/api/skills/", {
      method: "POST",
      body: input,
    });
  }

  discover(query?: {
    q?: string;
    category?: string;
    limit?: number;
  }): Promise<PaginatedResponse<Skill>> {
    const params = new URLSearchParams();
    if (query?.q) params.set("q", query.q);
    if (query?.category) params.set("category", query.category);
    if (query?.limit) params.set("limit", String(query.limit));
    const qs = params.toString();
    return this.client.request(`/api/skills/discover${qs ? `?${qs}` : ""}`);
  }

  get(slugOrId: string): Promise<{ skill: Skill }> {
    return this.client.request(`/api/skills/${encodeURIComponent(slugOrId)}`);
  }

  update(skillId: string, input: UpdateSkillInput): Promise<{ success: boolean }> {
    return this.client.request(`/api/skills/${skillId}`, {
      method: "PATCH",
      body: input,
    });
  }

  delete(skillId: string): Promise<{ success: boolean }> {
    return this.client.request(`/api/skills/${skillId}`, {
      method: "DELETE",
    });
  }
}
