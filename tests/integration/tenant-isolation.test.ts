import { beforeAll, describe, expect, it } from "vitest";
import { listAuditEvents } from "@/server/audit/audit";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createEstablishment,
  getEstablishment,
  listEstablishments,
  updateEstablishment,
  type Establishment,
} from "@/server/modules/establishments/service";
import {
  getOrganization,
  listMyOrganizations,
  updateOrganization,
} from "@/server/modules/organizations/service";
import { withTenant, withUser } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

/**
 * Dos restaurantes (organizaciones) independientes: A y B. Cada prueba intenta
 * que un usuario de A lea o modifique datos de B por la capa de servicios.
 */
describe("aislamiento entre organizaciones (capa de servicios)", () => {
  let alice: AuthUser; // propietaria de A
  let bob: AuthUser; // propietario de B
  let orgA: string;
  let orgB: string;
  let estA: Establishment;
  let estB: Establishment;

  beforeAll(async () => {
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    orgA = await createTestOrganization(alice, "rest-a");
    orgB = await createTestOrganization(bob, "rest-b");
    estA = await withTenant(alice, orgA, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Local A", slug: `local-a-${uniqueSuffix()}` }),
    );
    estB = await withTenant(bob, orgB, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Local B", slug: `local-b-${uniqueSuffix()}` }),
    );
  });

  it("cada usuario solo ve sus organizaciones", async () => {
    const aliceOrgs = await withUser(alice, (tx, ctx) => listMyOrganizations(tx, ctx));
    expect(aliceOrgs.map((o) => o.id)).toEqual([orgA]);
    const bobOrgs = await withUser(bob, (tx, ctx) => listMyOrganizations(tx, ctx));
    expect(bobOrgs.map((o) => o.id)).toEqual([orgB]);
  });

  it("no permite abrir el contexto de una organización ajena (responde NotFound)", async () => {
    await expect(withTenant(alice, orgB, (tx, ctx) => getOrganization(tx, ctx))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      withTenant(alice, orgB, (tx, ctx) => listEstablishments(tx, ctx)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(alice, orgB, (tx, ctx) => createEstablishment(tx, ctx, { name: "Intruso", slug: "intruso" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(alice, orgB, (tx, ctx) => updateOrganization(tx, ctx, { name: "Hackeado" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rechaza identificadores de organización mal formados", async () => {
    await expect(withTenant(alice, "' OR 1=1 --", async () => "x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lista solo los establecimientos de la organización propia", async () => {
    const list = await withTenant(alice, orgA, (tx, ctx) => listEstablishments(tx, ctx));
    expect(list.map((e) => e.id)).toEqual([estA.id]);
  });

  it("no permite leer un establecimiento de B usando su id desde el contexto de A (IDOR)", async () => {
    await expect(
      withTenant(alice, orgA, (tx, ctx) => getEstablishment(tx, ctx, estB.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no permite modificar un establecimiento de B desde el contexto de A", async () => {
    await expect(
      withTenant(alice, orgA, (tx, ctx) => updateEstablishment(tx, ctx, estB.id, { name: "Hackeado" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    const unchanged = await withTenant(bob, orgB, (tx, ctx) => getEstablishment(tx, ctx, estB.id));
    expect(unchanged.name).toBe("Local B");
  });

  it("ignora organization_id enviado por el cliente (asignación masiva)", async () => {
    await expect(
      withTenant(alice, orgA, (tx, ctx) =>
        createEstablishment(tx, ctx, { name: "Colado", slug: `colado-${uniqueSuffix()}`, organizationId: orgB }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withTenant(alice, orgA, (tx, ctx) =>
        updateEstablishment(tx, ctx, estA.id, { organization_id: orgB }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    const count = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM establishments WHERE organization_id = $1", [orgB]),
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("la auditoría de A no contiene eventos de B", async () => {
    const events = await withTenant(alice, orgA, (tx, ctx) => listAuditEvents(tx, ctx));
    expect(events.length).toBeGreaterThan(0);
    const entityIds = events.map((e) => e.entityId);
    expect(entityIds).toContain(estA.id);
    expect(entityIds).not.toContain(estB.id);
    expect(entityIds).not.toContain(orgB);
  });

  it("una membresía suspendida pierde el acceso inmediatamente", async () => {
    const carol = await createTestUser("carol");
    await addMember(orgA, carol, "manager");
    await expect(withTenant(carol, orgA, (tx, ctx) => listEstablishments(tx, ctx))).resolves.toHaveLength(1);
    await withAdminClient((c) =>
      c.query("UPDATE memberships SET status = 'suspended' WHERE organization_id = $1 AND user_id = $2", [
        orgA,
        carol.id,
      ]),
    );
    await expect(
      withTenant(carol, orgA, (tx, ctx) => listEstablishments(tx, ctx)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("permisos por rol dentro de una organización", () => {
  let owner: AuthUser;
  let staff: AuthUser;
  let manager: AuthUser;
  let org: string;
  let est: Establishment;

  beforeAll(async () => {
    owner = await createTestUser("owner");
    staff = await createTestUser("staff");
    manager = await createTestUser("manager");
    org = await createTestOrganization(owner, "rest-roles");
    await addMember(org, staff, "staff");
    await addMember(org, manager, "manager");
    est = await withTenant(owner, org, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` }),
    );
  });

  it("staff puede leer pero no crear ni modificar establecimientos", async () => {
    await expect(withTenant(staff, org, (tx, ctx) => listEstablishments(tx, ctx))).resolves.toHaveLength(1);
    await expect(
      withTenant(staff, org, (tx, ctx) => createEstablishment(tx, ctx, { name: "X", slug: "staff-x" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(staff, org, (tx, ctx) => updateEstablishment(tx, ctx, est.id, { name: "X" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("manager puede modificar pero no crear establecimientos ni leer auditoría", async () => {
    await expect(
      withTenant(manager, org, (tx, ctx) => updateEstablishment(tx, ctx, est.id, { name: "Renombrado" })),
    ).resolves.toMatchObject({ name: "Renombrado" });
    await expect(
      withTenant(manager, org, (tx, ctx) => createEstablishment(tx, ctx, { name: "X", slug: "manager-x" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(manager, org, (tx, ctx) => listAuditEvents(tx, ctx))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("solo owner/admin pueden renombrar la organización", async () => {
    await expect(
      withTenant(manager, org, (tx, ctx) => updateOrganization(tx, ctx, { name: "Otro" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await withTenant(owner, org, (tx, ctx) => updateOrganization(tx, ctx, { name: "Nuevo nombre" }));
    const o = await withTenant(staff, org, (tx, ctx) => getOrganization(tx, ctx));
    expect(o.name).toBe("Nuevo nombre");
  });

  it("el rol se lee de la base de datos, no de la entrada", async () => {
    await expect(
      withTenant(staff, org, (tx, ctx) =>
        createEstablishment(tx, { ...ctx }, { name: "X", slug: "staff-y", role: "owner" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
