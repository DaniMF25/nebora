import "server-only";
import type { AuthUser } from "@/server/auth/service";
import { withTransaction, type Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { isUuid } from "@/server/validation";
import { isRole, permissionsFor, type Permission, type Role } from "./permissions";

export interface UserContext {
  userId: string;
}

export interface TenantContext extends UserContext {
  organizationId: string;
  role: Role;
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
    const { rows } = await tx.query<{ role: string; all_establishments: boolean; establishment_ids: string[] }>(
      `SELECT m.role, m.all_establishments,
              coalesce(array_agg(me.establishment_id) FILTER (WHERE me.establishment_id IS NOT NULL), '{}')
                AS establishment_ids
         FROM memberships m
         LEFT JOIN membership_establishments me ON me.organization_id = m.organization_id AND me.membership_id = m.id
        WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
        GROUP BY m.id`,
      [organizationId, user.id],
    );
    const role = rows[0]?.role;
    if (!isRole(role)) throw new NotFoundError();
    const all = rows[0]!.all_establishments;
    return fn(tx, {
      userId: user.id,
      organizationId,
      role,
      permissions: permissionsFor(role, all),
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
