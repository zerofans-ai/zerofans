import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { agents } from "../db/schema";

export async function getAgentOwner(
  db: Database,
  agentId: string,
): Promise<string | undefined> {
  const row = await db
    .select({ ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .get();
  return row?.ownerUserId;
}

export async function makeUniqueSlug(
  baseName: string,
  db: Database,
): Promise<string> {
  const base = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let slug = base;
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.slug, slug))
      .get();
    if (!existing) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    attempts++;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
