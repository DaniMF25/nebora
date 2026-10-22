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
    const { rows } = await tx.query<{ role: string }>(
      `SELECT m.role FROM memberships m
        WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [organizationId, user.id],
    );
    const role = rows[0]?.role;
    if (!isRole(role)) throw new NotFoundError();
    await tx.query("SELECT set_config('app.org_id', $1, true)", [organizationId]);
    return fn(tx, {
      userId: user.id,
      organizationId,
      role,
      permissions: permissionsFor(role),
    });
  });
}

export function requirePermission(ctx: TenantContext, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}
