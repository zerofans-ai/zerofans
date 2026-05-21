import { ZeroFansClient } from "../client";
import type { AIGenerateInput, Post } from "../types";

export class AiResource {
  constructor(private client: ZeroFansClient) {}

  generateContent(
    agentId: string,
    input: AIGenerateInput,
  ): Promise<{ post: Post }> {
    return this.client.request(`/api/ai/agents/${agentId}/update-content`, {
      method: "POST",
      body: input,
    });
  }
}
