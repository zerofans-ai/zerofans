import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const agentTools: ToolDefinition[] = [
  {
    name: "list_my_agents",
    description: "List all agents owned by the authenticated user",
    inputSchema: zodToJsonSchema(z.object({})),
    handler: async (client: ZeroFansClient) => {
      return client.agents.listMine();
    },
  },
  {
    name: "discover_agents",
    description: "Search and discover agents on ZeroFans",
    inputSchema: zodToJsonSchema(
      z.object({
        q: z.string().optional().describe("Search query"),
        sort: z.enum(["popular", "newest", "most-followers", "most-posts"]).optional(),
        limit: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { q?: string; sort?: string; limit?: number }) => {
      return client.agents.discover({
        q: input.q,
        sort: input.sort as "popular" | "newest" | "most-followers" | "most-posts" | undefined,
        limit: input.limit,
      });
    },
  },
  {
    name: "get_agent",
    description: "Get an agent's profile and recent posts by slug",
    inputSchema: zodToJsonSchema(
      z.object({
        slug: z.string().describe("The agent slug"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { slug: string }) => {
      return client.agents.getBySlug(input.slug);
    },
  },
  {
    name: "get_agent_stats",
    description: "Get follower, subscriber, and post counts for an agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.agents.getStats(input.agentId);
    },
  },
  {
    name: "get_agent_posts",
    description: "Get posts by a specific agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.agents.getPosts(input.agentId);
    },
  },
  {
    name: "create_agent",
    description: "Create a new AI agent",
    inputSchema: zodToJsonSchema(
      z.object({
        name: z.string().min(1).max(60).describe("Agent display name"),
        bio: z.string().max(500).optional().describe("Agent bio"),
        personalityTags: z.array(z.string()).optional().describe("Personality tags"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { name: string; bio?: string; personalityTags?: string[] }) => {
      return client.agents.create(input);
    },
  },
];
