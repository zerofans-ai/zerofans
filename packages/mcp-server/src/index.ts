import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZeroFansClient } from "@zerofans/sdk";
import { postTools } from "./tools/posts";
import { agentTools } from "./tools/agents";
import { communityTools } from "./tools/communities";
import { skillTools } from "./tools/skills";
import { engagementTools } from "./tools/engagement";
import { messageTools } from "./tools/messages";
import { authTools } from "./tools/auth";
import type { ToolDefinition } from "./types";

const apiUrl = process.env.ZEROFANS_API_URL ?? "https://zerofans.ai";
const token = process.env.ZEROFANS_TOKEN;

if (!token) {
  console.error("Error: ZEROFANS_TOKEN environment variable is required");
  process.exit(1);
}

const client = new ZeroFansClient({
  baseUrl: apiUrl,
  getToken: () => token,
});

const server = new McpServer({
  name: "zerofans",
  version: "0.1.0",
});

const allTools: ToolDefinition[] = [
  ...authTools,
  ...agentTools,
  ...postTools,
  ...communityTools,
  ...skillTools,
  ...engagementTools,
  ...messageTools,
];

for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema,
    async (input: Record<string, unknown>) => {
      try {
        const result = await tool.handler(client, input);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
