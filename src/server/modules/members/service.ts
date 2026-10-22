import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { emailSchema, registerSchema } from "@/server/auth/schemas";
import { hashPassword } from "@/server/auth/password";
import type { AuthUser } from "@/server/auth/service";
import { generateToken, hashToken, isWellFormedToken } from "@/server/auth/tokens";
import { isUniqueViolation, withTransaction, type Tx } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { requirePermission, withUser, type TenantContext } from "@/server/tenancy/context";
import { isRole, ROLES, type Role } from "@/server/tenancy/permissions";
import { isUuid, parseInput } from "@/server/validation";

export const INVITATION_TTL_DAYS = 7;
// La propiedad no se concede por invitación; requiere un cambio de rol hecho por un owner.
export const INVITABLE_ROLES = ["admin", "manager", "staff"] as const;

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  status: "active" | "suspended";
  createdAt: Date;
}

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  expiresAt: Date;
  status: "pending" | "expired";
}

export const createInvitationSchema = z
  .object({ email: emailSchema, role: z.enum(INVITABLE_ROLES) })
  .strict();

const changeRoleSchema = z.object({ role: z.enum(ROLES) }).strict();

export async function listMembers(tx: Tx, ctx: TenantContext): Promise<Member[]> {
  requirePermission(ctx, "members.read");
  const { rows } = await tx.query<Member>(
    `SELECT m.id AS "membershipId", m.user_id AS "userId", u.email::text AS email,
            u.display_name AS "displayName", m.role, m.status, m.created_at AS "createdAt"
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1
      ORDER BY u.display_name, u.email`,
    [ctx.organizationId],
  );
  return rows;
}

/**
 * Crea una invitación y devuelve el token en claro UNA sola vez. Mientras no
 * haya proveedor de correo, quien invita entrega el enlace manualmente.
 */
export async function createInvitation(
  tx: Tx,
  ctx: TenantContext,
  input: unknown,
): Promise<{ invitationId: string; token: string; expiresAt: Date }> {
  requirePermission(ctx, "members.manage");
  const data = parseInput(createInvitationSchema, input);

  const existing = await tx.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND u.email = $2`,
    [ctx.organizationId, data.email],
  );
  if (existing.rowCount) throw new ConflictError("Esa persona ya es miembro de la organización");

  // Una nueva invitación sustituye a la anterior abierta para el mismo correo.
  await tx.query(
    `UPDATE invitations SET revoked_at = now()
      WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [ctx.organizationId, data.email],
  );

  const token = generateToken();
  const { rows } = await tx.query<{ id: string; expires_at: Date }>(
    `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     RETURNING id, expires_at`,
    [ctx.organizationId, data.email, data.role, hashToken(token), ctx.userId, INVITATION_TTL_DAYS],
  );
  const inv = rows[0]!;
  await recordAudit(tx, ctx, {
    action: "invitation.created",
    entityType: "invitation",
    entityId: inv.id,
    metadata: { role: data.role },
  });
  return { invitationId: inv.id, token, expiresAt: inv.expires_at };
}

/** Invitaciones abiertas (no aceptadas ni revocadas), incluidas las caducadas. */
export async function listOpenInvitations(tx: Tx, ctx: TenantContext): Promise<InvitationView[]> {
  requirePermission(ctx, "members.manage");
  const { rows } = await tx.query<InvitationView>(
    `SELECT id, email::text AS email, role, created_at AS "createdAt", expires_at AS "expiresAt",
            CASE WHEN expires_at <= now() THEN 'expired' ELSE 'pending' END AS status
       FROM invitations
      WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [ctx.organizationId],
  );
  return rows;
}

export async function revokeInvitation(tx: Tx, ctx: TenantContext, invitationId: string): Promise<void> {
  requirePermission(ctx, "members.manage");
  if (!isUuid(invitationId)) throw new NotFoundError();
  const res = await tx.query(
    `UPDATE invitations SET revoked_at = now()
      WHERE organization_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [ctx.organizationId, invitationId],
  );
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, { action: "invitation.revoked", entityType: "invitation", entityId: invitationId });
}

interface LockedMembership {
  id: string;
  user_id: string;
  role: Role;
}

/**
 * Serializa los cambios de membresías de una organización bloqueando su fila y
 * vuelve a leer el rol del actor tras el bloqueo: el rol con el que se abrió el
 * contexto puede haber cambiado por una operación concurrente.
 */
async function lockForMembershipChange(tx: Tx, ctx: TenantContext): Promise<Role> {
  const org = await tx.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [ctx.organizationId]);
  if (org.rowCount !== 1) throw new ForbiddenError();
  const { rows } = await tx.query<{ role: string }>(
    `SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
    [ctx.organizationId, ctx.userId],
  );
  const role = rows[0]?.role;
  if (!isRole(role) || (role !== "owner" && role !== "admin")) throw new ForbiddenError();
  return role;
}

async function getTargetMembership(tx: Tx, ctx: TenantContext, membershipId: string): Promise<LockedMembership> {
  if (!isUuid(membershipId)) throw new NotFoundError();
  const { rows } = await tx.query<LockedMembership>(
    "SELECT id, user_id, role FROM memberships WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, membershipId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

async function countOtherActiveOwners(tx: Tx, ctx: TenantContext, excludeMembershipId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memberships
      WHERE organization_id = $1 AND role = 'owner' AND status = 'active' AND id <> $2`,
    [ctx.organizationId, excludeMembershipId],
  );
  return rows[0]!.n;
}

export async function changeMemberRole(
  tx: Tx,
  ctx: TenantContext,
  membershipId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "members.manage");
  const { role: newRole } = parseInput(changeRoleSchema, input);
  const actorRole = await lockForMembershipChange(tx, ctx);
  const target = await getTargetMembership(tx, ctx, membershipId);

  if (target.user_id === ctx.userId) throw new ForbiddenError("No puedes cambiar tu propio rol");
  if ((target.role === "owner" || newRole === "owner") && actorRole !== "owner") {
    throw new ForbiddenError("Solo un propietario puede conceder o retirar la propiedad");
  }
  if (target.role === newRole) return;
  if (target.role === "owner" && (await countOtherActiveOwners(tx, ctx, target.id)) === 0) {
    throw new ConflictError("La organización debe conservar al menos un propietario");
  }

  await tx.query("UPDATE memberships SET role = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    target.id,
    newRole,
  ]);
  await recordAudit(tx, ctx, {
    action: "membership.role_changed",
    entityType: "membership",
    entityId: target.id,
    metadata: { from: target.role, to: newRole },
  });
}

export async function removeMember(tx: Tx, ctx: TenantContext, membershipId: string): Promise<void> {
  requirePermission(ctx, "members.manage");
  const actorRole = await lockForMembershipChange(tx, ctx);
  const target = await getTargetMembership(tx, ctx, membershipId);

  if (target.role === "owner" && actorRole !== "owner") {
    throw new ForbiddenError("Solo un propietario puede retirar a otro propietario");
  }
  if (target.role === "owner" && (await countOtherActiveOwners(tx, ctx, target.id)) === 0) {
    throw new ConflictError("La organización debe conservar al menos un propietario");
  }

  await tx.query("DELETE FROM memberships WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    target.id,
  ]);
  await recordAudit(tx, ctx, {
    action: "membership.removed",
    entityType: "membership",
    entityId: target.id,
    metadata: { role: target.role, self: target.user_id === ctx.userId },
  });
}

// ---------------------------------------------------------------------------
// Lado del invitado
// ---------------------------------------------------------------------------

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: Role;
  status: "pending" | "accepted" | "revoked" | "expired";
}

/** Datos mínimos de una invitación para quien posee el token; null si no existe. */
export async function getInvitationPreview(tx: Tx, token: string): Promise<InvitationPreview | null> {
  if (!isWellFormedToken(token)) return null;
  const { rows } = await tx.query<{ organization_name: string; email: string; role: Role; status: InvitationPreview["status"] }>(
    "SELECT * FROM app.invitation_by_token($1)",
    [hashToken(token)],
  );
  const r = rows[0];
  return r ? { organizationName: r.organization_name, email: r.email, role: r.role, status: r.status } : null;
}

const INVITATION_ERRORS: Record<string, () => Error> = {
  invitation_invalid: () => new NotFoundError("La invitación no es válida, ha caducado o ya se usó"),
  invitation_email_mismatch: () =>
    new ForbiddenError("Esta invitación es para otra dirección de correo. Inicia sesión con esa cuenta"),
  already_member: () => new ConflictError("Ya eres miembro de esta organización"),
};

function mapInvitationError(err: unknown): unknown {
  const e = err as { code?: string; message?: string };
  if (e?.code === "P0001" && e.message && INVITATION_ERRORS[e.message]) return INVITATION_ERRORS[e.message]!();
  return err;
}

async function acceptInTx(tx: Tx, token: string): Promise<string> {
  if (!isWellFormedToken(token)) throw INVITATION_ERRORS.invitation_invalid!();
  try {
    const { rows } = await tx.query<{ org: string }>("SELECT app.accept_invitation($1) AS org", [hashToken(token)]);
    return rows[0]!.org;
  } catch (err) {
    throw mapInvitationError(err);
  }
}

/** Acepta una invitación como el usuario autenticado. Devuelve el id de la organización. */
export async function acceptInvitation(user: AuthUser, token: string): Promise<string> {
  return withUser(user, (tx) => acceptInTx(tx, token));
}

const registerWithInvitationSchema = z
  .object({ displayName: z.string(), password: z.string() })
  .strict();

/**
 * Crea la cuenta del invitado y acepta la invitación en una única transacción.
 * Funciona aunque el registro público esté desactivado: el token es la
 * autorización, y el correo se toma de la invitación (no del formulario).
 */
export async function registerWithInvitation(
  token: string,
  input: unknown,
): Promise<{ user: AuthUser; organizationId: string }> {
  const fields = parseInput(registerWithInvitationSchema, input);
  return withTransaction(async (tx) => {
    const preview = await getInvitationPreview(tx, token);
    if (!preview || preview.status !== "pending") throw INVITATION_ERRORS.invitation_invalid!();
    const data = parseInput(registerSchema, { ...fields, email: preview.email });
    const passwordHash = await hashPassword(data.password);
    let userId: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
        [data.email, data.displayName, passwordHash],
      );
      userId = rows[0]!.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("Ya existe una cuenta con ese correo. Inicia sesión para aceptar la invitación");
      }
      throw err;
    }
    await tx.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const organizationId = await acceptInTx(tx, token);
    return { user: { id: userId, email: data.email, displayName: data.displayName }, organizationId };
  });
}
