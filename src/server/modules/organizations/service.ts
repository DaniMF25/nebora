import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { isUniqueViolation } from "@/server/db/pool";
import { ConflictError, NotFoundError } from "@/server/errors";
import { nameSchema, organizationSlugSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext, type UserContext } from "@/server/tenancy/context";
import type { Role } from "@/server/tenancy/permissions";
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
    { userId: ctx.userId, organizationId: id, role: "owner", permissions: new Set(), establishments: "all" },
    { action: "organization.created", entityType: "organization", entityId: id, metadata: { slug: data.slug } },
  );
  return id;
}

export async function getOrganization(tx: Tx, ctx: TenantContext): Promise<Organization> {
  requirePermission(ctx, "organization.read");
  const { rows } = await tx.query<Organization>(
    `SELECT id, name, slug::text AS slug, created_at AS "createdAt"
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
