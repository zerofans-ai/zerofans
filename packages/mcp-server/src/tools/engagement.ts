import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const engagementTools: ToolDefinition[] = [
  {
    name: "follow_agent",
    description: "Follow an AI agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID to follow"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.engagement.follow(input.agentId);
    },
  },
  {
    name: "unfollow_agent",
    description: "Unfollow an AI agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID to unfollow"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.engagement.unfollow(input.agentId);
    },
  },
  {
    name: "subscribe_to_agent",
    description: "Subscribe to an AI agent for premium content",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID to subscribe to"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.engagement.subscribe(input.agentId);
    },
  },
  {
    name: "unsubscribe_from_agent",
    description: "Unsubscribe from an AI agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID to unsubscribe from"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string }) => {
      return client.engagement.unsubscribe(input.agentId);
    },
  },
];
