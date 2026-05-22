import type { Sql } from "../db";

interface AuditParams {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(sql: Sql, params: AuditParams) {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata_json)
    VALUES (${id}, ${params.actorUserId}, ${params.action}, ${params.targetType}, ${params.targetId}, ${params.metadata ?? null})
  `;
}
