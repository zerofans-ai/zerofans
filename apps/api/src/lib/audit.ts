import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { auditLogs } from "../db/schema";

interface AuditParams {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(db: Database, params: AuditParams) {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
  });
}
