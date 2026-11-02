import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { setMemberEstablishments } from "@/server/modules/members/service";
import {
  copyPreviousWeek,
  createShift,
  createStaffMember,
  deleteShift,
  deleteStaffMember,
  getWeekRota,
  listStaffMembers,
  updateShift,
  updateStaffMember,
} from "@/server/modules/staff/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const MONDAY = "2026-11-09";

// Personal y turnos (D-045).
describe("personal y turnos", () => {
  let owner: AuthUser;
  let manager: AuthUser; // solo Centro
  let waiter: AuthUser; // rol staff
  let outsider: AuthUser;
  let org: string;
  let otherOrg: string;
  let centro: string;
  let playa: string;
  let ana: string;
  let bruno: string;

  const as =
    (u: AuthUser) =>
    <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) =>
      withTenant(u, org, fn);
  const shift = (
    staffMemberId: string,
    date: string,
    start: string,
    end: string,
    extra: Record<string, unknown> = {},
  ) => ({
    staffMemberId,
    date,
    start,
    end,
    position: "",
    notes: "",
    ...extra,
  });

  beforeAll(async () => {
    owner = await createTestUser("staff-owner");
    manager = await createTestUser("staff-manager");
    waiter = await createTestUser("staff-waiter");
    outsider = await createTestUser("staff-outsider");
    org = await createTestOrganization(owner, "Turnos");
    otherOrg = await createTestOrganization(outsider, "Ajena");
    await addMember(org, manager, "manager");
    await addMember(org, waiter, "staff");
    await as(owner)(async (tx, ctx) => {
      centro = (
        await createEstablishment(tx, ctx, {
          name: "Centro",
          slug: `centro-${uniqueSuffix()}`,
          timezone: "Europe/Madrid",
        })
      ).id;
      playa = (
        await createEstablishment(tx, ctx, {
          name: "Playa",
          slug: `playa-${uniqueSuffix()}`,
          timezone: "Europe/Madrid",
        })
      ).id;
      ana = (await createStaffMember(tx, ctx, { name: "Ana", position: "Sala", userId: waiter.id })).id;
      bruno = (await createStaffMember(tx, ctx, { name: "Bruno", position: "Cocina", userId: "" })).id;
    });
    const membership = (
      await withAdminClient((c) =>
        c.query("SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, manager.id]),
      )
    ).rows[0].id;
    await as(owner)((tx, ctx) =>
      setMemberEstablishments(tx, ctx, membership, { allEstablishments: false, establishmentIds: [centro] }),
    );
  });

  it("fichas: vínculo solo con miembros de la organización y una ficha por cuenta", async () => {
    await as(owner)(async (tx, ctx) => {
      const list = await listStaffMembers(tx, ctx);
      expect(list.map((m) => [m.name, m.position, m.userName])).toEqual([
        ["Ana", "Sala", waiter.displayName],
        ["Bruno", "Cocina", null],
      ]);
    });
    await expect(
      as(owner)((tx, ctx) => createStaffMember(tx, ctx, { name: "Intrusa", userId: outsider.id })),
    ).rejects.toThrow(ValidationError);
    await expect(
      as(owner)((tx, ctx) => createStaffMember(tx, ctx, { name: "Ana bis", userId: waiter.id })),
    ).rejects.toThrow(ConflictError);
    await expect(as(owner)((tx, ctx) => createStaffMember(tx, ctx, { name: "  " }))).rejects.toThrow(ValidationError);
    // Editar sin el campo de cuenta conserva el vínculo; con "" lo quita.
    await as(owner)(async (tx, ctx) => {
      expect((await updateStaffMember(tx, ctx, ana, { name: "Ana", position: "Sala", active: true })).userId).toBe(
        waiter.id,
      );
      expect((await updateStaffMember(tx, ctx, ana, { name: "Ana", active: true, userId: "" })).userId).toBeNull();
      expect(
        (await updateStaffMember(tx, ctx, ana, { name: "Ana", position: "Sala", active: true, userId: waiter.id }))
          .userId,
      ).toBe(waiter.id);
    });
  });

  it("turnos: sin solapes para una persona, también entre locales; consecutivos y de madrugada sí", async () => {
    await as(owner)(async (tx, ctx) => {
      const s = await createShift(tx, ctx, centro, shift(ana, MONDAY, "10:00", "16:00", { position: "Barra" }));
      expect(s).toMatchObject({ date: MONDAY, start: "10:00", end: "16:00", minutes: 360, position: "Barra" });
      // Consecutivo: [16:00, 20:00) no se solapa con [10:00, 16:00).
      await createShift(tx, ctx, centro, shift(ana, MONDAY, "16:00", "20:00"));
      // De madrugada: 20:00 → 02:00 del día siguiente.
      const night = await createShift(tx, ctx, centro, shift(bruno, MONDAY, "20:00", "02:00"));
      expect(night.minutes).toBe(360);
      expect(night.endsAt.toISOString()).toBe("2026-11-10T01:00:00.000Z");
    });
    // Otra persona a la misma hora, sin problema; la misma persona en otro local, no.
    await expect(
      as(owner)((tx, ctx) => createShift(tx, ctx, playa, shift(ana, MONDAY, "15:00", "18:00"))),
    ).rejects.toThrow(ConflictError);
    await expect(
      as(owner)((tx, ctx) => createShift(tx, ctx, centro, shift(bruno, addDay(MONDAY), "01:00", "05:00"))),
    ).rejects.toThrow(ConflictError);
  });

  it("valida duración, horas y personas desactivadas", async () => {
    const rejects = (input: Record<string, unknown>) =>
      expect(as(owner)((tx, ctx) => createShift(tx, ctx, centro, input))).rejects.toThrow(ValidationError);
    await rejects(shift(bruno, "2026-11-11", "06:00", "23:30")); // 17 h 30
    await rejects(shift(bruno, "2026-11-11", "10:00", "10:00"));
    await rejects(shift(bruno, "2026-11-31", "10:00", "12:00"));
    await rejects(shift(bruno, "2026-11-11", "25:00", "12:00"));
    await rejects({ ...shift(bruno, "2026-11-11", "10:00", "12:00"), organizationId: otherOrg });
    const temp = await as(owner)((tx, ctx) => createStaffMember(tx, ctx, { name: "Temporal" }));
    await as(owner)((tx, ctx) => updateStaffMember(tx, ctx, temp.id, { name: "Temporal", active: false }));
    await rejects(shift(temp.id, "2026-11-11", "10:00", "12:00"));
  });

  it("dos altas simultáneas que se solapan: solo entra una", async () => {
    const results = await Promise.allSettled(
      ["10:00", "11:00"].map((start) =>
        as(owner)((tx, ctx) => createShift(tx, ctx, centro, shift(bruno, "2026-11-12", start, "14:00"))),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictError);
  });

  it("cambio de hora: el turno del 29 de marzo de 00:00 a 06:00 dura 5 horas", async () => {
    const s = await as(owner)((tx, ctx) => createShift(tx, ctx, centro, shift(bruno, "2026-03-29", "00:00", "06:00")));
    expect(s.minutes).toBe(300);
    expect([s.start, s.end]).toEqual(["00:00", "06:00"]);
  });

  it("cuadrante semanal: de lunes a domingo, solo este local y horas por persona", async () => {
    const rota = await as(owner)((tx, ctx) => getWeekRota(tx, ctx, centro, "2026-11-13"));
    expect(rota.weekStart).toBe(MONDAY);
    expect(rota.days).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(rota.shifts.every((s) => s.establishmentId === centro)).toBe(true);
    expect(rota.minutesByMember[ana]).toBe(600); // 6 h + 4 h
    // Madrugada del lunes + el turno del jueves que ganó la carrera (10:00 u 11:00 a 14:00).
    expect([360 + 240, 360 + 180]).toContain(rota.minutesByMember[bruno]);
  });

  it("modificar y borrar turnos; mover un turno a una hora ocupada falla", async () => {
    await as(owner)(async (tx, ctx) => {
      const s = await createShift(tx, ctx, playa, shift(ana, "2026-11-14", "12:00", "16:00"));
      const moved = await updateShift(
        tx,
        ctx,
        playa,
        s.id,
        shift(ana, "2026-11-14", "13:00", "17:30", { notes: "Evento" }),
      );
      expect(moved).toMatchObject({ start: "13:00", end: "17:30", minutes: 270, notes: "Evento" });
      // De otro local no se encuentra.
      await expect(updateShift(tx, ctx, centro, s.id, shift(ana, "2026-11-14", "13:00", "17:00"))).rejects.toThrow(
        NotFoundError,
      );
      await deleteShift(tx, ctx, playa, s.id);
      expect((await getWeekRota(tx, ctx, playa, "2026-11-14")).shifts.some((x) => x.id === s.id)).toBe(false);
    });
    const centroShift = (await as(owner)((tx, ctx) => getWeekRota(tx, ctx, centro, MONDAY))).shifts.find(
      (s) => s.staffMemberId === ana && s.start === "16:00",
    )!;
    await expect(
      as(owner)((tx, ctx) => updateShift(tx, ctx, centro, centroShift.id, shift(ana, MONDAY, "15:00", "20:00"))),
    ).rejects.toThrow(ConflictError);
  });

  it("copiar la semana anterior: mismas horas; la segunda vez se salta lo que ya está", async () => {
    const nextMonday = "2026-11-16";
    const first = await as(owner)((tx, ctx) => copyPreviousWeek(tx, ctx, centro, nextMonday));
    const before = (await as(owner)((tx, ctx) => getWeekRota(tx, ctx, centro, MONDAY))).shifts;
    expect(first).toEqual({ copied: before.length, skipped: 0 });
    const after = (await as(owner)((tx, ctx) => getWeekRota(tx, ctx, centro, nextMonday))).shifts;
    expect(after.map((s) => [s.staffMemberId, s.start, s.end])).toEqual(
      before.map((s) => [s.staffMemberId, s.start, s.end]),
    );
    expect(after[0]!.date).toBe(nextMonday);
    expect(await as(owner)((tx, ctx) => copyPreviousWeek(tx, ctx, centro, nextMonday))).toEqual({
      copied: 0,
      skipped: before.length,
    });
  });

  it("permisos: el personal ve el cuadrante pero no lo cambia", async () => {
    await as(waiter)(async (tx, ctx) => {
      expect((await getWeekRota(tx, ctx, centro, MONDAY)).shifts.length).toBeGreaterThan(0);
      expect((await listStaffMembers(tx, ctx)).length).toBe(2);
      await expect(createShift(tx, ctx, centro, shift(ana, "2026-11-20", "10:00", "12:00"))).rejects.toThrow(
        ForbiddenError,
      );
      await expect(createStaffMember(tx, ctx, { name: "Nueva" })).rejects.toThrow(ForbiddenError);
      await expect(copyPreviousWeek(tx, ctx, centro, "2026-11-23")).rejects.toThrow(ForbiddenError);
    });
  });

  it("acceso por local: el encargado de Centro no ve ni toca los turnos de Playa (servicio y RLS)", async () => {
    const playaShift = await as(owner)((tx, ctx) =>
      createShift(tx, ctx, playa, shift(bruno, "2026-11-20", "10:00", "12:00")),
    );
    await as(manager)(async (tx, ctx) => {
      await expect(getWeekRota(tx, ctx, playa, MONDAY)).rejects.toThrow(NotFoundError);
      await expect(createShift(tx, ctx, playa, shift(bruno, "2026-11-21", "10:00", "12:00"))).rejects.toThrow(
        NotFoundError,
      );
      await expect(deleteShift(tx, ctx, playa, playaShift.id)).rejects.toThrow(NotFoundError);
      await createShift(tx, ctx, centro, shift(bruno, "2026-11-21", "10:00", "12:00"));
    });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [manager.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
        const { rows } = await c.query("SELECT DISTINCT establishment_id FROM staff_shifts");
        expect(rows.map((r) => r.establishment_id)).toEqual([centro]);
        // Aunque conozca el id, no puede insertar en Playa.
        await expect(
          c.query(
            `INSERT INTO staff_shifts (organization_id, establishment_id, staff_member_id, starts_at, ends_at)
             VALUES ($1, $2, $3, '2026-12-01T10:00Z', '2026-12-01T12:00Z')`,
            [org, playa, bruno],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("aislamiento: otra organización no ve fichas ni turnos, ni puede usarlas", async () => {
    await withTenant(outsider, otherOrg, async (tx, ctx) => {
      expect(await listStaffMembers(tx, ctx, { includeInactive: true })).toEqual([]);
      await expect(getWeekRota(tx, ctx, centro, MONDAY)).rejects.toThrow(NotFoundError);
      const est = (await createEstablishment(tx, ctx, { name: "Suyo", slug: `suyo-${uniqueSuffix()}` })).id;
      // Una ficha de otra organización no sirve para un turno propio.
      await expect(createShift(tx, ctx, est, shift(ana, "2026-11-20", "10:00", "12:00"))).rejects.toThrow(
        ValidationError,
      );
      await expect(updateStaffMember(tx, ctx, ana, { name: "Robada", active: true })).rejects.toThrow(NotFoundError);
    });
  });

  it("borrar: con turnos no se puede (se desactiva); sin turnos sí; queda auditado", async () => {
    await expect(as(owner)((tx, ctx) => deleteStaffMember(tx, ctx, bruno))).rejects.toThrow(ConflictError);
    const temp = await as(owner)((tx, ctx) => createStaffMember(tx, ctx, { name: "Sin turnos" }));
    await as(owner)((tx, ctx) => deleteStaffMember(tx, ctx, temp.id));
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT action FROM audit_events WHERE organization_id = $1 AND action LIKE 'staff.%'", [org]),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "staff.member_created",
      "staff.member_updated",
      "staff.member_deleted",
      "staff.shift_created",
      "staff.shift_updated",
      "staff.shift_deleted",
      "staff.week_copied",
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
  });
});

function addDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
