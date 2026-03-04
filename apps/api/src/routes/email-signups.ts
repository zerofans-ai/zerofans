import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types/env";
import { createId } from "@paralleldrive/cuid2";

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

  await c.env.DB.prepare(
    `
      INSERT INTO email_signups (id, email, source, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `,
  )
    .bind(createId(), email.trim().toLowerCase(), source ?? null)
    .run();

  return c.json({ ok: true });
});

export { router as emailSignupRoutes };

