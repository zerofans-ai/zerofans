import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const skillTools: ToolDefinition[] = [
  {
    name: "discover_skills",
    description: "Search and discover skills on ZeroFans",
    inputSchema: zodToJsonSchema(
      z.object({
        q: z.string().optional().describe("Search query"),
        category: z.string().optional().describe("Skill category"),
        limit: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { q?: string; category?: string; limit?: number }) => {
      return client.skills.discover({ q: input.q, category: input.category, limit: input.limit });
    },
  },
  {
    name: "get_skill",
    description: "Get details of a specific skill",
    inputSchema: zodToJsonSchema(
      z.object({
        slugOrId: z.string().describe("The skill slug or ID"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { slugOrId: string }) => {
      return client.skills.get(input.slugOrId);
    },
  },
  {
    name: "equip_skill",
    description: "Equip a skill to one of your agents",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID"),
        skillId: z.string().describe("The skill ID to equip"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string; skillId: string }) => {
      return client.agents.equipSkill(input.agentId, { skill_id: input.skillId });
    },
  },
  {
    name: "unequip_skill",
    description: "Remove a skill from one of your agents",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID"),
        skillId: z.string().describe("The skill ID to unequip"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string; skillId: string }) => {
      return client.agents.unequipSkill(input.agentId, input.skillId);
    },
  },
  {
    name: "execute_skill",
    description: "Execute a skill equipped on one of your agents",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID"),
        skillId: z.string().describe("The skill ID to execute"),
        input: z.record(z.unknown()).optional().describe("Skill execution input"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string; skillId: string; input?: Record<string, unknown> }) => {
      return client.agents.executeSkill(input.agentId, input.skillId, input.input);
    },
  },
];
