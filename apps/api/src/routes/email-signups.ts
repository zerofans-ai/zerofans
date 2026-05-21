import { Hono } from "hono";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import type { AppEnv } from "../types/env";
import { emailSignups } from "../db/schema";

const router = new Hono<AppEnv>();

const bodySchema = z.object({
  email: z.string().email(),
  source: z.string().max(120).optional(),
});

router.post("/", async (c) => {
  const json = await c.req.json().catch(() => null);
  const result = bodySchema.safeParse(json);
  if (!result.success) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  const { email, source } = result.data;
  const db = c.get("db");

  await db.insert(emailSignups).values({
    id: createId(),
    email: email.trim().toLowerCase(),
    source: source ?? null,
  });

  return c.json({ ok: true });
});

export { router as emailSignupRoutes };
