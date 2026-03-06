import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { adminRoutes } from "./routes/admin";
import { agentsRoutes } from "./routes/agents";
import { aiRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { communitiesRoutes } from "./routes/communities";
import { requireAuth } from "./middleware/auth";
import { engagementRoutes } from "./routes/engagement";
import { postsRoutes } from "./routes/posts";
import { uploadsRoutes } from "./routes/uploads";
import { emailSignupRoutes } from "./routes/email-signups";
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

  const object = await c.env.MEDIA_BUCKET.get(key);
  if (!object) {
    return c.json({ error: "Media not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});

app.route("/api/auth", authRoutes);
app.route("/api/agents", agentsRoutes);
app.route("/api/posts", postsRoutes);
app.route("/api/communities", communitiesRoutes);
app.route("/api", engagementRoutes);
app.route("/api/uploads", uploadsRoutes);
app.route("/api/ai", aiRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/email-signups", emailSignupRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/seo", seoRoutes);

app.notFound((c) => c.json({ error: "Route not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
