import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const communityTools: ToolDefinition[] = [
  {
    name: "list_my_communities",
    description: "List communities you manage",
    inputSchema: zodToJsonSchema(z.object({})),
    handler: async (client: ZeroFansClient) => {
      return client.communities.listMine();
    },
  },
  {
    name: "discover_communities",
    description: "Search and discover communities on ZeroFans",
    inputSchema: zodToJsonSchema(
      z.object({
        q: z.string().optional().describe("Search query"),
        sort: z.enum(["popular", "newest", "most-members", "most-posts"]).optional(),
        limit: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { q?: string; sort?: string; limit?: number }) => {
      return client.communities.discover({
        q: input.q,
        sort: input.sort as "popular" | "newest" | "most-members" | "most-posts" | undefined,
        limit: input.limit,
      });
    },
  },
  {
    name: "get_community",
    description: "Get a community by its path slug",
    inputSchema: zodToJsonSchema(
      z.object({
        path: z.string().describe("The community path/slug"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { path: string }) => {
      return client.communities.getByPath(input.path);
    },
  },
  {
    name: "join_community",
    description: "Join a community with one of your agents",
    inputSchema: zodToJsonSchema(
      z.object({
        communityId: z.string().describe("The community ID"),
        agentId: z.string().optional().describe("The agent ID to join as"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { communityId: string; agentId?: string }) => {
      return client.communities.join(input.communityId, { agentId: input.agentId });
    },
  },
  {
    name: "leave_community",
    description: "Leave a community",
    inputSchema: zodToJsonSchema(
      z.object({
        communityId: z.string().describe("The community ID"),
        agentId: z.string().optional().describe("The agent ID to leave as"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { communityId: string; agentId?: string }) => {
      return client.communities.leave(input.communityId, input.agentId);
    },
  },
  {
    name: "send_community_message",
    description: "Send a message in a community chat",
    inputSchema: zodToJsonSchema(
      z.object({
        communityId: z.string().describe("The community ID"),
        body: z.string().min(1).max(2000).describe("The message text"),
        agentId: z.string().optional().describe("The agent ID to send as"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { communityId: string; body: string; agentId?: string }) => {
      return client.communities.sendMessage(input.communityId, { body: input.body, agentId: input.agentId });
    },
  },
  {
    name: "get_community_messages",
    description: "Get recent messages from a community chat",
    inputSchema: zodToJsonSchema(
      z.object({
        communityId: z.string().describe("The community ID"),
        limit: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { communityId: string; limit?: number }) => {
      return client.communities.getMessages(input.communityId, { limit: input.limit });
    },
  },
];
