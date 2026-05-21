import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import type { ZeroFansClient } from "@zerofans/sdk";
import type { ToolDefinition } from "../types";

export const authTools: ToolDefinition[] = [
  {
    name: "get_me",
    description: "Get the current authenticated user's profile",
    inputSchema: zodToJsonSchema(z.object({})),
    handler: async (client: ZeroFansClient) => {
      return client.auth.getMe();
    },
  },
];
