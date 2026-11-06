import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createIngredient, listStock } from "@/server/modules/inventory/service";
import { listMembers, removeMember } from "@/server/modules/members/service";
import { createMenu } from "@/server/modules/menus/menus";
import { createProduct } from "@/server/modules/menus/products";
import { changePlan, getOrganization } from "@/server/modules/organizations/service";
import { getPublicBookingInfo } from "@/server/modules/public-booking/service";
import { createSupplier } from "@/server/modules/purchasing/service";
import { setRecipeLine } from "@/server/modules/recipes/service";
import { listReservationsForDay } from "@/server/modules/reservations/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { createShift, listStaffMembers } from "@/server/modules/staff/service";
import { getEstablishmentStats } from "@/server/modules/stats/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const BOOKING = {
  publicEnabled: true,
  minParty: 1,
  maxParty: 6,
  durationMinutes: 90,
  slotIntervalMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
  autoConfirm: true,
};

// Planes de la organización (D-046).
describe("planes", () => {
  let owner: AuthUser;
  let admin: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: string;
  let estSlug: string;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("plan-owner");
    admin = await createTestUser("plan-admin");
    org = await createTestOrganization(owner, "Planes", "basic");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    estSlug = `local-${uniqueSuffix()}`;
    est = await asOwner(async (tx, ctx) => (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug })).id);
  });

  it("el plan Básico incluye web, cartas, platos y estadísticas", async () => {
    await asOwner(async (tx, ctx) => {
      expect(ctx.plan).toBe("basic");
      expect((await getOrganization(tx, ctx)).plan).toBe("basic");
      for (const p of ["menus.edit", "menus.publish", "catalog.manage", "stats.read", "privacy.manage"] as const) {
        expect(ctx.permissions.has(p), p).toBe(true);
      }
      for (const p of [
        "reservations.read",
        "tables.read",
        "members.read",
        "staff.read",
        "inventory.read",
        "costs.read",
        "purchasing.read",
      ] as const) {
        expect(ctx.permissions.has(p), p).toBe(false);
      }
      await createProduct(tx, ctx, { name: "Croquetas", priceCents: 900 });
      await createMenu(tx, ctx, est, { name: "Carta", slug: "carta", theme: "moderno" });
      // Las estadísticas no incluyen el resumen de reservas.
      expect((await getEstablishmentStats(tx, ctx, est, 30)).reservations).toBeNull();
    });
  });

  it("en Básico el servidor rechaza reservas, sala, miembros, turnos e inventario", async () => {
    await asOwner(async (tx, ctx) => {
      await expect(listReservationsForDay(tx, ctx, est, "2030-01-01")).rejects.toThrow(ForbiddenError);
      await expect(updateReservationSettings(tx, ctx, est, BOOKING)).rejects.toThrow(ForbiddenError);
      await expect(listMembers(tx, ctx)).rejects.toThrow(ForbiddenError);
      await expect(listStaffMembers(tx, ctx)).rejects.toThrow(ForbiddenError);
      await expect(listStock(tx, ctx)).rejects.toThrow(ForbiddenError);
      // Con el permiso de platos (todos los planes) no se llega a la gestión de cocina y compras.
      await expect(createIngredient(tx, ctx, { name: "Harina", baseUnit: "g" })).rejects.toThrow(ForbiddenError);
      await expect(createSupplier(tx, ctx, { name: "Proveedor" })).rejects.toThrow(ForbiddenError);
      const dish = await createProduct(tx, ctx, { name: "Tortilla", priceCents: 800 });
      await expect(
        setRecipeLine(tx, ctx, dish.id, { ingredientId: dish.id, quantity: "1", unit: "g" }),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  it("la BD no deja activar la reserva online con plan Básico", async () => {
    await expect(
      withAdminClient((c) =>
        c.query(
          `INSERT INTO reservation_settings (organization_id, establishment_id, public_enabled) VALUES ($1, $2, true)
           ON CONFLICT (establishment_id) DO UPDATE SET public_enabled = true`,
          [org, est],
        ),
      ),
    ).rejects.toThrow(/plan_without_booking/);
  });

  it("solo el propietario cambia el plan; un plan inventado no vale", async () => {
    await addMember(org, admin, "admin");
    await expect(withTenant(admin, org, (tx, ctx) => changePlan(tx, ctx, { plan: "pro" }))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "gratis" }))).rejects.toThrow(ValidationError);
    await expect(asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "pro", organizationId: org }))).rejects.toThrow(
      ValidationError,
    );
  });

  it("Avanzado: reservas y reserva online; bajar a Básico exige quedarse solo y apaga la reserva online", async () => {
    expect(await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }))).toEqual({
      from: "basic",
      to: "advanced",
    });
    await asOwner(async (tx, ctx) => {
      expect(ctx.permissions.has("reservations.manage")).toBe(true);
      expect(ctx.permissions.has("inventory.read")).toBe(false);
      await updateReservationSettings(tx, ctx, est, BOOKING);
    });
    expect(await getPublicBookingInfo(orgSlug, estSlug)).not.toBeNull();

    // Con otro miembro no se puede bajar a Básico.
    await expect(asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" }))).rejects.toThrow(ConflictError);
    const adminMembership = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((m) => m.userId === admin.id)!;
    await asOwner((tx, ctx) => removeMember(tx, ctx, adminMembership.membershipId));

    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" }));
    expect(await getPublicBookingInfo(orgSlug, estSlug)).toBeNull();
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT public_enabled FROM reservation_settings WHERE establishment_id = $1", [est]),
    );
    expect(rows[0].public_enabled).toBe(false);
  });

  it("bajar de PRO no borra datos: vuelven al subir de nuevo", async () => {
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }));
    const staffMember = await withAdminClient(
      async (c) =>
        (await c.query("INSERT INTO staff_members (organization_id, name) VALUES ($1, 'Ana') RETURNING id", [org]))
          .rows[0].id as string,
    );
    await asOwner((tx, ctx) =>
      createShift(tx, ctx, est, { staffMemberId: staffMember, date: "2030-01-07", start: "10:00", end: "14:00" }),
    );
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "pro" }));
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }));
    await asOwner(async (tx, ctx) => {
      expect(ctx.permissions.has("inventory.read")).toBe(false);
      expect((await listStaffMembers(tx, ctx)).map((m) => m.name)).toEqual(["Ana"]);
    });
    const { rows } = await withAdminClient((c) =>
      c.query(
        "SELECT metadata FROM audit_events WHERE organization_id = $1 AND action = 'organization.plan_changed' ORDER BY created_at",
        [org],
      ),
    );
    expect(rows.map((r) => `${r.metadata.from}>${r.metadata.to}`)).toEqual([
      "basic>advanced",
      "advanced>basic",
      "basic>advanced",
      "advanced>pro",
      "pro>advanced",
    ]);
  });
});
