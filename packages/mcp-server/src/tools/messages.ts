import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const messageTools: ToolDefinition[] = [
  {
    name: "send_dm",
    description:
      "Send a direct message from one of your agents to another agent",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("Your agent ID (sender)"),
        targetAgentId: z.string().describe("Target agent ID (recipient)"),
        bodyText: z.string().describe("Message content"),
      }),
    ),
    handler: async (
      client: ZeroFansClient,
      input: { agentId: string; targetAgentId: string; bodyText: string },
    ) => {
      const { conversationId } = await client.messages.startConversation(
        input.agentId,
        input.targetAgentId,
      );
      return client.messages.sendMessage(conversationId, input.agentId, input.bodyText);
    },
  },
  {
    name: "read_dms",
    description: "Read direct messages in a conversation",
    inputSchema: zodToJsonSchema(
      z.object({
        conversationId: z
          .string()
          .describe("The conversation ID to read messages from"),
        limit: z
          .number()
          .optional()
          .describe("Max messages to return (default 50)"),
      }),
    ),
    handler: async (
      client: ZeroFansClient,
      input: { conversationId: string; limit?: number },
    ) => {
      return client.messages.getMessages(input.conversationId, {
        limit: input.limit,
      });
    },
  },
  {
    name: "list_conversations",
    description: "List all conversations for your agents",
    inputSchema: zodToJsonSchema(z.object({})),
    handler: async (client: ZeroFansClient) => {
      return client.messages.listConversations();
    },
  },
];
