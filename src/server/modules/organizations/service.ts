import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { slugify } from "@/lib/slug";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { isUniqueViolation } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { nameSchema, organizationSlugSchema } from "@/server/modules/shared-schemas";
import { requirePermission, type TenantContext, type UserContext } from "@/server/tenancy/context";
import { PLANS, type Plan, type Role } from "@/server/tenancy/permissions";
import { parseInput } from "@/server/validation";
import { TRIAL_DAYS } from "@/lib/plans";
import { republishMenus } from "@/server/modules/menus/menus";

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
  plan: Plan;
  /** Fin de la prueba gratuita del PRO, si está en curso (D-062). */
  trialEndsAt: Date | null;
}

/** Base del identificador automático: el nombre sin tildes ni símbolos, o «restaurante». */
function autoSlugBase(name: string): string {
  return slugify(name, 45) || "restaurante";
}

function withSuffix(base: string): string {
  return `${base}-${randomBytes(2).toString("hex")}`;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  plan: Plan;
  trialEndsAt: Date | null;
}

// `.strict()` rechaza campos no previstos (asignación masiva: organization_id, role...).
// Identificador opcional: vacío, se genera a partir del nombre.
export const createOrganizationSchema = z
  .object({ name: nameSchema, slug: z.union([z.literal(""), organizationSlugSchema]).optional() })
  .strict();
export const updateOrganizationSchema = z.object({ name: nameSchema }).strict();

/** Organizaciones en las que el usuario es miembro activo. */
export async function listMyOrganizations(tx: Tx, ctx: UserContext): Promise<OrganizationSummary[]> {
  const { rows } = await tx.query<OrganizationSummary>(
    `SELECT o.id, o.name, o.slug::text AS slug, m.role,
            -- Una prueba ya terminada se muestra como Básico aunque aún no se haya aplicado (D-062).
            CASE WHEN o.trial_ends_at <= now() THEN 'basic' ELSE o.plan END AS plan,
            CASE WHEN o.trial_ends_at > now() THEN o.trial_ends_at END AS "trialEndsAt"
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
  // Sin identificador, se propone uno a partir del nombre; si ya existe o no
  // es válido (reservado, demasiado corto), se le añade un sufijo aleatorio.
  const chosen = data.slug || null;
  const base = chosen ?? autoSlugBase(data.name);
  let id: string | null = null;
  let slug = "";
  for (let attempt = 0; id === null; attempt++) {
    slug = chosen ?? (attempt === 0 && organizationSlugSchema.safeParse(base).success ? base : withSuffix(base));
    try {
      await tx.query("SAVEPOINT create_org");
      const { rows } = await tx.query<{ id: string }>("SELECT app.create_organization($1, $2) AS id", [
        data.name,
        slug,
      ]);
      await tx.query("RELEASE SAVEPOINT create_org");
      id = rows[0]!.id;
    } catch (err) {
      await tx.query("ROLLBACK TO SAVEPOINT create_org");
      if (!isUniqueViolation(err)) throw err;
      if (chosen || attempt >= 4) throw new ConflictError("Ese identificador ya está en uso");
    }
  }
  // La organización recién creada pasa a ser el contexto para auditar su alta.
  await tx.query("SELECT set_config('app.org_id', $1, true)", [id]);
  // Prueba gratuita del PRO (D-062): solo la primera organización de cada persona.
  const trial = await tx.query<{ started: boolean }>("SELECT app.start_trial($1, $2) AS started", [id, TRIAL_DAYS]);
  await recordAudit(
    tx,
    { userId: ctx.userId, organizationId: id, role: "owner", plan: "basic", permissions: new Set(), establishments: "all" },
    {
      action: "organization.created",
      entityType: "organization",
      entityId: id,
      metadata: { slug, trial: trial.rows[0]!.started },
    },
  );
  return id;
}

export async function getOrganization(tx: Tx, ctx: TenantContext): Promise<Organization> {
  requirePermission(ctx, "organization.read");
  const { rows } = await tx.query<Organization>(
    `SELECT id, name, slug::text AS slug, created_at AS "createdAt", plan, trial_ends_at AS "trialEndsAt"
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
  // El nombre de la organización sale en las cartas publicadas (D-048).
  await republishMenus(tx, ctx, { organization: true });
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
  const { rows } = await tx.query<{ plan: Plan; trial: boolean }>(
    "SELECT plan, trial_ends_at IS NOT NULL AS trial FROM organizations WHERE id = $1 FOR UPDATE",
    [ctx.organizationId],
  );
  const from = rows[0]!.plan;
  const inTrial = rows[0]!.trial;
  // Elegir un plan termina la prueba (D-062), aunque sea el mismo PRO de la prueba.
  if (from === plan && !inTrial) return { from, to: plan };
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
  await tx.query("UPDATE organizations SET plan = $2, trial_ends_at = NULL WHERE id = $1", [ctx.organizationId, plan]);
  await recordAudit(tx, ctx, {
    action: "organization.plan_changed",
    entityType: "organization",
    entityId: ctx.organizationId,
    metadata: { from, to: plan, endedTrial: inTrial },
  });
  return { from, to: plan };
}

/** ¿Puede el usuario empezar aún su prueba gratuita del PRO? (una por persona, D-062). */
export async function canStartTrial(tx: Tx, ctx: UserContext): Promise<boolean> {
  const { rows } = await tx.query<{ unused: boolean }>("SELECT trial_used_at IS NULL AS unused FROM users WHERE id = $1", [
    ctx.userId,
  ]);
  return rows[0]?.unused ?? false;
}

/** Número de locales de la organización a los que accede la cuenta (RLS), para el selector de organizaciones. */
export async function countAccessibleEstablishments(tx: Tx, ctx: TenantContext): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM establishments WHERE organization_id = $1",
    [ctx.organizationId],
  );
  return rows[0]!.n;
}
