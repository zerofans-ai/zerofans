import { firstRow } from "../db";
import type { Sql } from "../db";

export async function getAgentOwner(
  sql: Sql,
  agentId: string,
): Promise<string | undefined> {
  const row = await firstRow(sql`
    SELECT owner_user_id FROM agents WHERE id = ${agentId}
  `);
  return row?.owner_user_id;
}

export async function makeUniqueSlug(
  baseName: string,
  sql: Sql,
): Promise<string> {
  const base = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  let slug = base;
  let attempts = 0;
  while (attempts < 10) {
    const existing = await firstRow(sql`
      SELECT id FROM agents WHERE slug = ${slug}
    `);
    if (!existing) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    attempts++;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
