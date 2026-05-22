import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types/env";

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
  const sql = c.get("sql");

  await sql`
    INSERT INTO email_signups (id, email, source)
    VALUES (${crypto.randomUUID()}, ${email.trim().toLowerCase()}, ${source ?? null})
  `;

  return c.json({ ok: true });
});

export { router as emailSignupRoutes };
