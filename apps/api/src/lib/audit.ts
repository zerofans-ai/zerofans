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

type Insertable = { insert: Database["insert"] };

export async function writeAuditLog(db: Insertable, params: AuditParams) {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadataJson: params.metadata ?? null,
  });
}
