import "server-only";
import type { AuthUser } from "@/server/auth/service";
import { withTransaction, type Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { isUuid } from "@/server/validation";
import { isPlan, isRole, permissionsFor, type Permission, type Plan, type Role } from "./permissions";

export interface UserContext {
  userId: string;
}

export interface TenantContext extends UserContext {
  organizationId: string;
  role: Role;
  /** Plan de la organización (D-046): limita los permisos del rol. */
  plan: Plan;
  /**
   * Bloqueada por no tener plan (fin de la prueba, D-068): sin permisos salvo
   * ver la organización; solo el propietario puede elegir plan.
   */
  lockedAt: Date | null;
  permissions: ReadonlySet<Permission>;
  /**
   * Locales a los que accede: "all" o los identificadores asignados. RLS
   * aplica lo mismo en la base de datos (D-031); esto permite responder
   * NotFound antes y ocultar lo que no le corresponde.
   */
  establishments: "all" | ReadonlySet<string>;
}

async function setUserContext(tx: Tx, userId: string): Promise<void> {
  await tx.query("SELECT set_config('app.user_id', $1, true)", [userId]);
}

/**
 * Transacción con el usuario autenticado como contexto RLS, sin organización
 * activa (p. ej. listar sus organizaciones o crear una nueva).
 */
export function withUser<T>(user: AuthUser, fn: (tx: Tx, ctx: UserContext) => Promise<T>): Promise<T> {
  return withTransaction(async (tx) => {
    await setUserContext(tx, user.id);
    return fn(tx, { userId: user.id });
  });
}

/**
 * Transacción dentro de una organización. El `organizationId` procede del
 * cliente (URL o formulario) y por eso se valida aquí contra la membresía real
 * del usuario autenticado. Si no es miembro activo se responde NotFound, sin
 * revelar si la organización existe.
 */
export async function withTenant<T>(
  user: AuthUser,
  organizationId: string,
  fn: (tx: Tx, ctx: TenantContext) => Promise<T>,
): Promise<T> {
  if (!isUuid(organizationId)) throw new NotFoundError();
  return withTransaction(async (tx) => {
    await setUserContext(tx, user.id);
    // La organización va en el contexto antes de leer el ámbito: RLS solo
    // muestra las filas de membership_establishments de la organización activa
    // (y solo si se es miembro, que se comprueba justo después).
    await tx.query("SELECT set_config('app.org_id', $1, true)", [organizationId]);
    // Prueba gratuita terminada (D-062): pasa al Básico antes de leer el plan,
    // para que el panel nunca dé permisos del PRO después de la fecha.
    const trial = await tx.query<{ expired: boolean }>(
      "SELECT trial_ends_at <= now() AS expired FROM organizations WHERE id = $1",
      [organizationId],
    );
    if (trial.rows[0]?.expired) await tx.query("SELECT app.expire_trials()");
    const { rows } = await tx.query<{
      role: string;
      plan: string;
      locked_at: Date | null;
      all_establishments: boolean;
      establishment_ids: string[];
    }>(
      `SELECT m.role, o.plan, o.locked_at, m.all_establishments,
              coalesce(array_agg(me.establishment_id) FILTER (WHERE me.establishment_id IS NOT NULL), '{}')
                AS establishment_ids
         FROM memberships m
         JOIN organizations o ON o.id = m.organization_id
         LEFT JOIN membership_establishments me ON me.organization_id = m.organization_id AND me.membership_id = m.id
        WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
        GROUP BY m.id, o.plan, o.locked_at`,
      [organizationId, user.id],
    );
    const role = rows[0]?.role;
    if (!isRole(role)) throw new NotFoundError();
    const all = rows[0]!.all_establishments;
    const plan = rows[0]!.plan;
    if (!isPlan(plan)) throw new Error("Plan de organización desconocido");
    const lockedAt = rows[0]!.locked_at;
    const permissions = permissionsFor(role, all, plan);
    return fn(tx, {
      userId: user.id,
      organizationId,
      role,
      plan,
      lockedAt,
      // Bloqueada: nada salvo ver la organización (la comprobación es del servidor, D-068).
      permissions: lockedAt
        ? new Set([...permissions].filter((p) => p === "organization.read"))
        : permissions,
      establishments: all ? "all" : new Set(rows[0]!.establishment_ids),
    });
  });
}

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}

/** ¿Accede el miembro a este local? (RLS lo aplica también en la base de datos). */
export function canAccessEstablishment(ctx: TenantContext, establishmentId: string): boolean {
  return ctx.establishments === "all" || ctx.establishments.has(establishmentId);
}
