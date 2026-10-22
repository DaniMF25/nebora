import "server-only";
import type { Tx } from "@/server/db/pool";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Solo datos mínimos y no sensibles: nunca contraseñas, tokens ni datos personales innecesarios. */
  metadata?: Record<string, unknown>;
}

/** Registra un evento de auditoría en la misma transacción que el cambio auditado. */
export async function recordAudit(tx: Tx, ctx: TenantContext, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      ctx.organizationId,
      ctx.userId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export interface AuditEventView {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export async function listAuditEvents(tx: Tx, ctx: TenantContext, limit = 50): Promise<AuditEventView[]> {
  requirePermission(ctx, "audit.read");
  const { rows } = await tx.query<{
    id: string;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, actor_user_id, action, entity_type, entity_id, metadata, created_at
       FROM audit_events WHERE organization_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`,
    [ctx.organizationId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    actorUserId: r.actor_user_id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));
}
