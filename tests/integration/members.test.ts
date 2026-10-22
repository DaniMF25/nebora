import { beforeAll, describe, expect, it } from "vitest";
import { login, type AuthUser } from "@/server/auth/service";
import { hashToken } from "@/server/auth/tokens";
import { withTransaction } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  getInvitationPreview,
  listMembers,
  listOpenInvitations,
  registerWithInvitation,
  removeMember,
  revokeInvitation,
} from "@/server/modules/members/service";
import { listEstablishments } from "@/server/modules/establishments/service";
import { withTenant } from "@/server/tenancy/context";
import type { Role } from "@/server/tenancy/permissions";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, TEST_PASSWORD, uniqueSuffix } from "../support/factories";

async function invite(actor: AuthUser, org: string, email: string, role: Role = "staff") {
  return withTenant(actor, org, (tx, ctx) => createInvitation(tx, ctx, { email, role }));
}

async function membershipId(org: string, user: AuthUser): Promise<string> {
  const { rows } = await withAdminClient((c) =>
    c.query("SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, user.id]),
  );
  return rows[0]!.id;
}

async function roleOf(org: string, user: AuthUser): Promise<string | undefined> {
  const { rows } = await withAdminClient((c) =>
    c.query("SELECT role FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, user.id]),
  );
  return rows[0]?.role;
}

describe("invitaciones", () => {
  let owner: AuthUser;
  let org: string;

  beforeAll(async () => {
    owner = await createTestUser("inv-owner");
    org = await createTestOrganization(owner, "inv");
  });

  it("se aceptan una sola vez y el token solo se guarda como hash", async () => {
    const invitee = await createTestUser("invitee");
    const { token, invitationId } = await invite(owner, org, invitee.email, "manager");

    const { rows } = await withAdminClient((c) =>
      c.query("SELECT token_hash FROM invitations WHERE id = $1", [invitationId]),
    );
    expect(rows[0].token_hash).toBe(hashToken(token));

    expect(await acceptInvitation(invitee, token)).toBe(org);
    expect(await roleOf(org, invitee)).toBe("manager");
    await expect(acceptInvitation(invitee, token)).rejects.toBeInstanceOf(NotFoundError);
    const preview = await withTransaction((tx) => getInvitationPreview(tx, token));
    expect(preview?.status).toBe("accepted");
  });

  it("está ligada al correo invitado", async () => {
    const invitee = await createTestUser("target");
    const other = await createTestUser("other");
    const { token } = await invite(owner, org, invitee.email);
    await expect(acceptInvitation(other, token)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await roleOf(org, other)).toBeUndefined();
    // Sigue siendo válida para su destinatario.
    await expect(acceptInvitation(invitee, token)).resolves.toBe(org);
  });

  it("no se puede aceptar caducada, revocada o con un token inventado", async () => {
    const u1 = await createTestUser("expired");
    const expired = await invite(owner, org, u1.email);
    await withAdminClient((c) =>
      c.query(
        "UPDATE invitations SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE id = $1",
        [expired.invitationId],
      ),
    );
    await expect(acceptInvitation(u1, expired.token)).rejects.toBeInstanceOf(NotFoundError);

    const u2 = await createTestUser("revoked");
    const revoked = await invite(owner, org, u2.email);
    await withTenant(owner, org, (tx, ctx) => revokeInvitation(tx, ctx, revoked.invitationId));
    await expect(acceptInvitation(u2, revoked.token)).rejects.toBeInstanceOf(NotFoundError);

    await expect(acceptInvitation(u2, "A".repeat(43))).rejects.toBeInstanceOf(NotFoundError);
    await expect(acceptInvitation(u2, "no-es-un-token")).rejects.toBeInstanceOf(NotFoundError);
    expect(await roleOf(org, u1)).toBeUndefined();
    expect(await roleOf(org, u2)).toBeUndefined();
  });

  it("reinvitar sustituye la invitación anterior", async () => {
    const u = await createTestUser("reinvite");
    const first = await invite(owner, org, u.email);
    const second = await invite(owner, org, u.email, "admin");
    await expect(acceptInvitation(u, first.token)).rejects.toBeInstanceOf(NotFoundError);
    await acceptInvitation(u, second.token);
    expect(await roleOf(org, u)).toBe("admin");
  });

  it("no permite invitar como propietario, ni a un miembro existente, ni con campos extra", async () => {
    const u = await createTestUser("as-owner");
    await expect(invite(owner, org, u.email, "owner")).rejects.toBeInstanceOf(ValidationError);
    await expect(invite(owner, org, owner.email)).rejects.toBeInstanceOf(ConflictError);
    await expect(
      withTenant(owner, org, (tx, ctx) =>
        createInvitation(tx, ctx, { email: u.email, role: "staff", organizationId: org }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("manager y staff no pueden invitar ni ver invitaciones", async () => {
    const manager = await createTestUser("inv-manager");
    const staff = await createTestUser("inv-staff");
    await addMember(org, manager, "manager");
    await addMember(org, staff, "staff");
    for (const u of [manager, staff]) {
      await expect(invite(u, org, `x-${uniqueSuffix()}@example.test`)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(withTenant(u, org, (tx, ctx) => listOpenInvitations(tx, ctx))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    // Y RLS tampoco se las muestra aunque consulten directamente.
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [
        staff.id,
        org,
      ]);
      const { rows } = await c.query("SELECT count(*)::int AS n FROM invitations");
      await c.query("ROLLBACK");
      expect(rows[0].n).toBe(0);
    });
  });

  it("dos aceptaciones simultáneas del mismo token: solo una tiene éxito", async () => {
    const u = await createTestUser("race-accept");
    const { token } = await invite(owner, org, u.email);
    const results = await Promise.allSettled([acceptInvitation(u, token), acceptInvitation(u, token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, u.id]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("permite crear cuenta con la invitación aunque el registro público esté desactivado", async () => {
    const email = `nuevo-${uniqueSuffix()}@example.test`;
    const { token } = await invite(owner, org, email);
    const preview = await withTransaction((tx) => getInvitationPreview(tx, token));
    expect(preview).toMatchObject({ email, role: "staff", status: "pending" });

    // El correo sale de la invitación; no se acepta otro desde el formulario.
    await expect(
      registerWithInvitation(token, { displayName: "Nuevo", password: TEST_PASSWORD, email: "otro@example.test" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const { user, organizationId } = await registerWithInvitation(token, {
      displayName: "Nuevo",
      password: TEST_PASSWORD,
    });
    expect(user.email).toBe(email);
    expect(organizationId).toBe(org);
    await expect(login({ email, password: TEST_PASSWORD })).resolves.toBeTruthy();
    await expect(registerWithInvitation(token, { displayName: "Otra vez", password: TEST_PASSWORD })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("un registro con contraseña inválida no crea la cuenta ni consume la invitación", async () => {
    const email = `fallo-${uniqueSuffix()}@example.test`;
    const { token } = await invite(owner, org, email);
    await expect(registerWithInvitation(token, { displayName: "X", password: "corta" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const preview = await withTransaction((tx) => getInvitationPreview(tx, token));
    expect(preview?.status).toBe("pending");
  });
});

describe("invitaciones entre organizaciones", () => {
  it("un admin de A no ve ni revoca invitaciones de B", async () => {
    const ownerA = await createTestUser("x-owner-a");
    const ownerB = await createTestUser("x-owner-b");
    const orgA = await createTestOrganization(ownerA, "x-a");
    const orgB = await createTestOrganization(ownerB, "x-b");
    const invB = await invite(ownerB, orgB, `b-${uniqueSuffix()}@example.test`);
    await invite(ownerA, orgA, `a-${uniqueSuffix()}@example.test`);

    const listA = await withTenant(ownerA, orgA, (tx, ctx) => listOpenInvitations(tx, ctx));
    expect(listA.map((i) => i.id)).not.toContain(invB.invitationId);
    await expect(
      withTenant(ownerA, orgA, (tx, ctx) => revokeInvitation(tx, ctx, invB.invitationId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(invite(ownerA, orgB, `c-${uniqueSuffix()}@example.test`)).rejects.toBeInstanceOf(NotFoundError);

    const membersA = await withTenant(ownerA, orgA, (tx, ctx) => listMembers(tx, ctx));
    expect(membersA.map((m) => m.userId)).toEqual([ownerA.id]);
    // Un id de membresía de B no se puede tocar desde A.
    const bOwnerMembership = await membershipId(orgB, ownerB);
    await expect(
      withTenant(ownerA, orgA, (tx, ctx) => removeMember(tx, ctx, bOwnerMembership)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(ownerA, orgA, (tx, ctx) => changeMemberRole(tx, ctx, bOwnerMembership, { role: "staff" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await roleOf(orgB, ownerB)).toBe("owner");
  });
});

describe("gestión de miembros y prevención de escalada", () => {
  let owner: AuthUser;
  let admin: AuthUser;
  let staff: AuthUser;
  let org: string;

  beforeAll(async () => {
    owner = await createTestUser("m-owner");
    admin = await createTestUser("m-admin");
    staff = await createTestUser("m-staff");
    org = await createTestOrganization(owner, "m");
    await addMember(org, admin, "admin");
    await addMember(org, staff, "staff");
  });

  it("un admin no puede nombrar propietarios ni tocar al propietario", async () => {
    const staffM = await membershipId(org, staff);
    const ownerM = await membershipId(org, owner);
    await expect(
      withTenant(admin, org, (tx, ctx) => changeMemberRole(tx, ctx, staffM, { role: "owner" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(admin, org, (tx, ctx) => changeMemberRole(tx, ctx, ownerM, { role: "staff" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(admin, org, (tx, ctx) => removeMember(tx, ctx, ownerM))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await roleOf(org, owner)).toBe("owner");
    expect(await roleOf(org, staff)).toBe("staff");
  });

  it("nadie puede cambiar su propio rol", async () => {
    const adminM = await membershipId(org, admin);
    await expect(
      withTenant(admin, org, (tx, ctx) => changeMemberRole(tx, ctx, adminM, { role: "owner" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("staff no puede gestionar miembros", async () => {
    const adminM = await membershipId(org, admin);
    await expect(
      withTenant(staff, org, (tx, ctx) => changeMemberRole(tx, ctx, adminM, { role: "staff" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(staff, org, (tx, ctx) => removeMember(tx, ctx, adminM))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("el único propietario no puede abandonar la organización", async () => {
    const ownerM = await membershipId(org, owner);
    await expect(withTenant(owner, org, (tx, ctx) => removeMember(tx, ctx, ownerM))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("un admin puede cambiar el rol de staff y un miembro eliminado pierde el acceso", async () => {
    const staffM = await membershipId(org, staff);
    await withTenant(admin, org, (tx, ctx) => changeMemberRole(tx, ctx, staffM, { role: "manager" }));
    expect(await roleOf(org, staff)).toBe("manager");
    await withTenant(admin, org, (tx, ctx) => removeMember(tx, ctx, staffM));
    await expect(withTenant(staff, org, (tx, ctx) => listEstablishments(tx, ctx))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("concurrencia en cambios de propiedad", () => {
  it("dos propietarios que se eliminan mutuamente a la vez: queda exactamente uno", async () => {
    const o1 = await createTestUser("c-o1");
    const o2 = await createTestUser("c-o2");
    const org = await createTestOrganization(o1, "conc");
    await addMember(org, o2, "owner");
    const m1 = await membershipId(org, o1);
    const m2 = await membershipId(org, o2);

    const results = await Promise.allSettled([
      withTenant(o1, org, (tx, ctx) => removeMember(tx, ctx, m2)),
      withTenant(o2, org, (tx, ctx) => removeMember(tx, ctx, m1)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM memberships WHERE organization_id = $1 AND role = 'owner'", [org]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("dos propietarios que se degradan mutuamente a la vez: queda al menos uno", async () => {
    const o1 = await createTestUser("d-o1");
    const o2 = await createTestUser("d-o2");
    const org = await createTestOrganization(o1, "conc-d");
    await addMember(org, o2, "owner");
    const m1 = await membershipId(org, o1);
    const m2 = await membershipId(org, o2);

    const results = await Promise.allSettled([
      withTenant(o1, org, (tx, ctx) => changeMemberRole(tx, ctx, m2, { role: "admin" })),
      withTenant(o2, org, (tx, ctx) => changeMemberRole(tx, ctx, m1, { role: "admin" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM memberships WHERE organization_id = $1 AND role = 'owner'", [org]),
    );
    expect(rows[0].n).toBe(1);
  });
});
