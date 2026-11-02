import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { isUniqueViolation } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { nameSchema, organizationSlugSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext, type UserContext } from "@/server/tenancy/context";
import { PLANS, type Plan, type Role } from "@/server/tenancy/permissions";
import { parseInput } from "@/server/validation";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  plan: Plan;
}

// `.strict()` rechaza campos no previstos (asignación masiva: organization_id, role...).
export const createOrganizationSchema = z.object({ name: nameSchema, slug: organizationSlugSchema }).strict();
export const updateOrganizationSchema = z.object({ name: nameSchema }).strict();

/** Organizaciones en las que el usuario es miembro activo. */
export async function listMyOrganizations(tx: Tx, ctx: UserContext): Promise<OrganizationSummary[]> {
  const { rows } = await tx.query<OrganizationSummary>(
    `SELECT o.id, o.name, o.slug::text AS slug, m.role
       FROM organizations o
       JOIN memberships m ON m.organization_id = o.id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY o.name`,
    [ctx.userId],
  );
  return rows;
}

export async function createOrganization(tx: Tx, ctx: UserContext, input: unknown): Promise<string> {
  const data = parseInput(createOrganizationSchema, input);
  let id: string;
  try {
    const { rows } = await tx.query<{ id: string }>("SELECT app.create_organization($1, $2) AS id", [
      data.name,
      data.slug,
    ]);
    id = rows[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("Ese identificador ya está en uso");
    throw err;
  }
  // La organización recién creada pasa a ser el contexto para auditar su alta.
  await tx.query("SELECT set_config('app.org_id', $1, true)", [id]);
  await recordAudit(
    tx,
    { userId: ctx.userId, organizationId: id, role: "owner", plan: "basic", permissions: new Set(), establishments: "all" },
    { action: "organization.created", entityType: "organization", entityId: id, metadata: { slug: data.slug } },
  );
  return id;
}

export async function getOrganization(tx: Tx, ctx: TenantContext): Promise<Organization> {
  requirePermission(ctx, "organization.read");
  const { rows } = await tx.query<Organization>(
    `SELECT id, name, slug::text AS slug, created_at AS "createdAt", plan
       FROM organizations WHERE id = $1`,
    [ctx.organizationId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateOrganization(tx: Tx, ctx: TenantContext, input: unknown): Promise<void> {
  requirePermission(ctx, "organization.update");
  const data = parseInput(updateOrganizationSchema, input);
  const result = await tx.query("UPDATE organizations SET name = $2 WHERE id = $1", [
    ctx.organizationId,
    data.name,
  ]);
  if (result.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, {
    action: "organization.updated",
    entityType: "organization",
    entityId: ctx.organizationId,
  });
}

/**
 * Cambia el plan de la organización (D-046). Solo el propietario: aún no hay
 * proveedor de cobros, así que no se cobra nada. Bajar no borra datos: solo
 * deja de mostrarlos. Para bajar a Básico no puede haber más miembros ni
 * invitaciones abiertas (la gestión de miembros es del plan Avanzado) y se
 * desactiva la reserva online de todos los locales.
 */
export async function changePlan(tx: Tx, ctx: TenantContext, input: unknown): Promise<{ from: Plan; to: Plan }> {
  if (ctx.role !== "owner") throw new ForbiddenError();
  const { plan } = parseInput(z.object({ plan: z.enum(PLANS, { message: "Elige un plan" }) }).strict(), input);
  const { rows } = await tx.query<{ plan: Plan }>("SELECT plan FROM organizations WHERE id = $1 FOR UPDATE", [
    ctx.organizationId,
  ]);
  const from = rows[0]!.plan;
  if (from === plan) return { from, to: plan };
  if (plan === "basic") {
    const others = await tx.query<{ members: number; invitations: number }>(
      `SELECT (SELECT count(*)::int FROM memberships WHERE organization_id = $1 AND user_id <> $2) AS members,
              (SELECT count(*)::int FROM invitations
                WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
                AS invitations`,
      [ctx.organizationId, ctx.userId],
    );
    const { members, invitations } = others.rows[0]!;
    if (members > 0 || invitations > 0) {
      throw new ConflictError(
        "El plan Básico es para una sola persona: quita antes a los demás miembros y revoca las invitaciones abiertas",
      );
    }
    await tx.query("UPDATE reservation_settings SET public_enabled = false WHERE organization_id = $1 AND public_enabled", [
      ctx.organizationId,
    ]);
  }
  await tx.query("UPDATE organizations SET plan = $2 WHERE id = $1", [ctx.organizationId, plan]);
  await recordAudit(tx, ctx, {
    action: "organization.plan_changed",
    entityType: "organization",
    entityId: ctx.organizationId,
    metadata: { from, to: plan },
  });
  return { from, to: plan };
}
