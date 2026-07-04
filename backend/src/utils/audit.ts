import { db } from '../db/client';
import { auditLogs } from '../db/schema';

export async function audit(action: string, input: {
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
} = {}) {
  await db.insert(auditLogs).values({
    userId: input.userId ?? null,
    action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
  });
}
