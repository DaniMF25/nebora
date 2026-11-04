import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { setMemberEstablishments } from "@/server/modules/members/service";
import {
  createShift,
  createStaffMember,
  listMyShifts,
  MY_SHIFTS_DAYS,
  updateStaffMember,
} from "@/server/modules/staff/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// «Mis turnos»: próximos turnos de la ficha vinculada a la cuenta de la sesión.
describe("mis turnos", () => {
  let owner: AuthUser;
  let waiter: AuthUser; // ficha «Ana», todos los locales
  let cook: AuthUser; // ficha «Bruno», solo Centro
  let unlinked: AuthUser; // miembro sin ficha
  let org: string;
  let centro: string;
  let playa: string;
  let ana: string;
  let bruno: string;
  // «Ahora» fijo: martes 9 de marzo de 2027, 13:00 en Madrid (12:00 UTC).
  const now = new Date("2027-03-09T12:00:00Z");

  const as =
    (u: AuthUser) =>
    <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) =>
      withTenant(u, org, fn);
  const shift = (staffMemberId: string, date: string, start: string, end: string, notes = "") => ({
    staffMemberId,
    date,
    start,
    end,
    position: "",
    notes,
  });

  beforeAll(async () => {
    owner = await createTestUser("my-owner");
    waiter = await createTestUser("my-waiter");
    cook = await createTestUser("my-cook");
    unlinked = await createTestUser("my-unlinked");
    org = await createTestOrganization(owner, "misturnos", "advanced");
    await addMember(org, waiter, "staff");
    await addMember(org, cook, "staff");
    await addMember(org, unlinked, "staff");
    await as(owner)(async (tx, ctx) => {
      centro = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
      playa = (await createEstablishment(tx, ctx, { name: "Playa", slug: `playa-${uniqueSuffix()}` })).id;
      ana = (await createStaffMember(tx, ctx, { name: "Ana", position: "Sala", userId: waiter.id })).id;
      bruno = (await createStaffMember(tx, ctx, { name: "Bruno", position: "Cocina", userId: cook.id })).id;
      await createShift(tx, ctx, centro, shift(ana, "2027-03-08", "12:00", "16:00")); // ayer: no
      await createShift(tx, ctx, centro, shift(ana, "2027-03-09", "12:00", "16:00", "Abre caja")); // en curso
      await createShift(tx, ctx, playa, shift(ana, "2027-03-12", "20:00", "02:00")); // de madrugada
      await createShift(tx, ctx, centro, shift(ana, "2027-03-22", "12:00", "16:00")); // dentro de 13 días
      await createShift(tx, ctx, centro, shift(ana, "2027-03-24", "12:00", "16:00")); // más allá: no
      await createShift(tx, ctx, centro, shift(bruno, "2027-03-10", "09:00", "13:00"));
      await createShift(tx, ctx, playa, shift(bruno, "2027-03-11", "09:00", "13:00"));
    });
    const membership = (
      await withAdminClient((c) =>
        c.query("SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, cook.id]),
      )
    ).rows[0].id;
    await as(owner)((tx, ctx) =>
      setMemberEstablishments(tx, ctx, membership, { allEstablishments: false, establishmentIds: [centro] }),
    );
  });

  it(`muestra solo los turnos propios desde el que está en curso hasta ${MY_SHIFTS_DAYS} días`, async () => {
    const mine = await as(waiter)((tx, ctx) => listMyShifts(tx, ctx, now));
    expect(mine?.map((s) => [s.date, s.start, s.end, s.establishmentName, s.ongoing])).toEqual([
      ["2027-03-09", "12:00", "16:00", "Centro", true],
      ["2027-03-12", "20:00", "02:00", "Playa", false],
      ["2027-03-22", "12:00", "16:00", "Centro", false],
    ]);
    // Sin puesto en el turno, el de la ficha.
    expect(mine?.[0]).toMatchObject({ notes: "Abre caja", minutes: 240, staffMemberId: ana, position: "Sala" });
    expect(mine?.[1]?.minutes).toBe(360);
  });

  it("sin ficha vinculada, o con la ficha desactivada, no hay turnos propios", async () => {
    expect(await withTenant(unlinked, org, (tx, ctx) => listMyShifts(tx, ctx, now))).toBeNull();
    // El propietario no tiene ficha: tampoco ve los de otros como si fueran suyos.
    expect(await as(owner)((tx, ctx) => listMyShifts(tx, ctx, now))).toBeNull();
    await as(owner)((tx, ctx) =>
      updateStaffMember(tx, ctx, bruno, { name: "Bruno", position: "Cocina", userId: cook.id, active: false }),
    );
    try {
      expect(await as(cook)((tx, ctx) => listMyShifts(tx, ctx, now))).toBeNull();
    } finally {
      await as(owner)((tx, ctx) =>
        updateStaffMember(tx, ctx, bruno, { name: "Bruno", position: "Cocina", userId: cook.id, active: true }),
      );
    }
  });

  it("acceso por local: solo los turnos de los locales a los que accede la cuenta", async () => {
    const mine = await as(cook)((tx, ctx) => listMyShifts(tx, ctx, now));
    expect(mine?.map((s) => [s.date, s.establishmentName])).toEqual([["2027-03-10", "Centro"]]);
  });

  it("aislamiento y plan: en otra organización no aparecen; en Básico no hay turnos", async () => {
    const otherOwner = await createTestUser("my-other");
    const other = await createTestOrganization(otherOwner, "otra", "advanced");
    await addMember(other, waiter, "staff");
    expect(await withTenant(waiter, other, (tx, ctx) => listMyShifts(tx, ctx, now))).toBeNull();
    const basic = await createTestOrganization(otherOwner, "basica", "basic");
    await addMember(basic, waiter, "staff");
    await expect(withTenant(waiter, basic, (tx, ctx) => listMyShifts(tx, ctx, now))).rejects.toThrow(
      ForbiddenError,
    );
  });
});
