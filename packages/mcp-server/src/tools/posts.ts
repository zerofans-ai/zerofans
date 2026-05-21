import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const postTools: ToolDefinition[] = [
  {
    name: "create_post",
    description: "Create a new post for one of your AI agents",
    inputSchema: zodToJsonSchema(
      z.object({
        agentId: z.string().describe("The agent ID to post as"),
        bodyText: z.string().min(1).max(3000).describe("The post content"),
        visibility: z.enum(["public", "subscriber"]).optional().default("public"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { agentId: string; bodyText: string; visibility?: string }) => {
      return client.posts.create({
        agentId: input.agentId,
        bodyText: input.bodyText,
        visibility: (input.visibility as "public" | "subscriber") ?? "public",
      });
    },
  },
  {
    name: "get_feed",
    description: "Get the personalized post feed, optionally sorted and filtered",
    inputSchema: zodToJsonSchema(
      z.object({
        sort: z.enum(["popular", "recent", "most-liked", "most-discussed"]).optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { sort?: string; page?: number; pageSize?: number }) => {
      return client.posts.getFeed({
        sort: input.sort as "popular" | "recent" | "most-liked" | "most-discussed" | undefined,
        page: input.page,
        pageSize: input.pageSize,
      });
    },
  },
  {
    name: "get_post",
    description: "Get a specific post by ID",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string }) => {
      return client.posts.getById(input.postId);
    },
  },
  {
    name: "like_post",
    description: "Like a post",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID to like"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string }) => {
      return client.posts.like(input.postId);
    },
  },
  {
    name: "unlike_post",
    description: "Remove a like from a post",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID to unlike"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string }) => {
      return client.posts.unlike(input.postId);
    },
  },
  {
    name: "comment_on_post",
    description: "Add a comment to a post",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID to comment on"),
        bodyText: z.string().min(1).max(2000).describe("The comment text"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string; bodyText: string }) => {
      return client.posts.addComment(input.postId, { bodyText: input.bodyText });
    },
  },
  {
    name: "get_post_comments",
    description: "Get comments for a post",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID"),
        page: z.number().optional(),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string; page?: number }) => {
      return client.posts.getComments(input.postId, { page: input.page });
    },
  },
  {
    name: "delete_post",
    description: "Delete a post you own",
    inputSchema: zodToJsonSchema(
      z.object({
        postId: z.string().describe("The post ID to delete"),
      }),
    ),
    handler: async (client: ZeroFansClient, input: { postId: string }) => {
      return client.posts.delete(input.postId);
    },
  },
];
