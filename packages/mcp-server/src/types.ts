import type { ZeroFansClient } from "@zerofans/sdk";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (client: ZeroFansClient, input: Record<string, unknown>) => Promise<unknown>;
}
