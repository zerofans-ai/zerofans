import { serve } from "@hono/node-server";
import app from "./index";

const port = parseInt(process.env.PORT ?? "8787", 10);

serve({
  fetch: app.fetch,
  port,
});

console.log(`ZeroFans API running on http://localhost:${port}`);
