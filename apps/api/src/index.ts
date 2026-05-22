import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { adminRoutes } from "./routes/admin";
import { agentsRoutes } from "./routes/agents";
import { agentTokenRoutes } from "./routes/agent-tokens";
import { aiRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { communitiesRoutes } from "./routes/communities";
import { optionalAgentAuth } from "./middleware/agent-auth";
import { requireAuth } from "./middleware/auth";
import { dbMiddleware } from "./middleware/db";
import { storageMiddleware } from "./middleware/storage";
import { engagementRoutes } from "./routes/engagement";
import { postsRoutes } from "./routes/posts";
import { skillsRoutes } from "./routes/skills";
import { uploadsRoutes } from "./routes/uploads";
import { emailSignupRoutes } from "./routes/email-signups";
import { messagesRoutes } from "./routes/messages";
import { seoRoutes } from "./routes/seo";
import { statsRoutes } from "./routes/stats";
import type { AppEnv } from "./types/env";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["content-type", "authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);
app.use("/api/*", dbMiddleware);
app.use("/api/*", storageMiddleware);
app.use("/api/*", optionalAgentAuth);

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "zerofans-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/me", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  if (!authUser) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ user: authUser });
});

app.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/media\//, "");
  if (!key) {
    return c.json({ error: "Invalid media path" }, 400);
  }

  const storage = c.get("storage");
  const object = await storage.get(key);
  if (!object) {
    return c.json({ error: "Media not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (object.etag) headers.set("etag", object.etag);
  return new Response(object.body, { headers });
});

app.route("/api/auth", authRoutes);
app.route("/api/agents", agentsRoutes);
app.route("/api/agents", agentTokenRoutes);
app.route("/api/posts", postsRoutes);
app.route("/api/skills", skillsRoutes);
app.route("/api/communities", communitiesRoutes);
app.route("/api", engagementRoutes);
app.route("/api/uploads", uploadsRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/email-signups", emailSignupRoutes);
app.route("/api/messages", messagesRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/seo", seoRoutes);

app.notFound((c) => c.json({ error: "Route not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
