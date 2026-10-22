import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import {
  deleteDateException,
  getSchedule,
  setDateException,
  setWeeklyHours,
} from "@/server/modules/schedules/service";
import { isOpenAt } from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const WEEK = [
  { weekday: 1, opens: "13:00", closes: "16:00" },
  { weekday: 1, opens: "20:00", closes: "23:30" },
  { weekday: 6, opens: "20:00", closes: "02:00" },
];

describe("horarios de apertura", () => {
  let owner: AuthUser;
  let staff: AuthUser;
  let manager: AuthUser;
  let org: string;
  let est: string;

  beforeAll(async () => {
    owner = await createTestUser("sch-owner");
    staff = await createTestUser("sch-staff");
    manager = await createTestUser("sch-manager");
    org = await createTestOrganization(owner, "sch");
    await addMember(org, staff, "staff");
    await addMember(org, manager, "manager");
    est = (
      await withTenant(owner, org, (tx, ctx) =>
        createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}`, timezone: "Europe/Madrid" }),
      )
    ).id;
  });

  it("guarda y devuelve el horario semanal, sustituyéndolo completo", async () => {
    await withTenant(owner, org, (tx, ctx) => setWeeklyHours(tx, ctx, est, { slots: WEEK }));
    let s = await withTenant(staff, org, (tx, ctx) => getSchedule(tx, ctx, est));
    expect(s.timezone).toBe("Europe/Madrid");
    expect(s.weekly).toEqual([
      { weekday: 1, opensMinute: 780, durationMinutes: 180 },
      { weekday: 1, opensMinute: 1200, durationMinutes: 210 },
      { weekday: 6, opensMinute: 1200, durationMinutes: 360 },
    ]);
    // Sábado 2026-10-24 a las 01:30 del domingo (hora local) sigue abierto.
    expect(isOpenAt(s, s.timezone, new Date("2026-10-25T00:30:00Z"))).toBe(true);

    await withTenant(manager, org, (tx, ctx) => setWeeklyHours(tx, ctx, est, { slots: [WEEK[0]] }));
    s = await withTenant(owner, org, (tx, ctx) => getSchedule(tx, ctx, est));
    expect(s.weekly).toHaveLength(1);
  });

  it("rechaza turnos solapados, horas mal formadas y campos extra sin modificar nada", async () => {
    await withTenant(owner, org, (tx, ctx) => setWeeklyHours(tx, ctx, est, { slots: WEEK }));
    for (const slots of [
      [...WEEK, { weekday: 1, opens: "15:00", closes: "17:00" }],
      [{ weekday: 1, opens: "25:00", closes: "26:00" }],
      [{ weekday: 1, opens: "10:00", closes: "10:00" }],
      [{ weekday: 9, opens: "10:00", closes: "11:00" }],
      [{ weekday: 1, opens: "10:00", closes: "11:00", organizationId: org }],
    ]) {
      await expect(withTenant(owner, org, (tx, ctx) => setWeeklyHours(tx, ctx, est, { slots }))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    const s = await withTenant(owner, org, (tx, ctx) => getSchedule(tx, ctx, est));
    expect(s.weekly).toHaveLength(3);
  });

  it("la base de datos impide turnos solapados aunque se salte la validación", async () => {
    await withAdminClient(async (c) => {
      await expect(
        c.query(
          `INSERT INTO opening_hours (organization_id, establishment_id, weekday, opens_minute, duration_minutes)
           VALUES ($1, $2, 1, 840, 60)`,
          [org, est],
        ),
      ).rejects.toThrow(/opening_hours_no_overlap/);
    });
  });

  it("staff no puede modificar horarios", async () => {
    await expect(
      withTenant(staff, org, (tx, ctx) => setWeeklyHours(tx, ctx, est, { slots: [] })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(staff, org, (tx, ctx) => setDateException(tx, ctx, est, { date: "2026-12-25", closed: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gestiona excepciones por fecha (cerrado o turnos especiales)", async () => {
    await withTenant(owner, org, (tx, ctx) =>
      setDateException(tx, ctx, est, { date: "2026-12-24", closed: false, slots: [{ opens: "12:00", closes: "17:00" }], note: "Nochebuena" }),
    );
    await withTenant(owner, org, (tx, ctx) => setDateException(tx, ctx, est, { date: "2026-12-25", closed: true }));
    // Sustituir una excepción existente.
    await withTenant(owner, org, (tx, ctx) =>
      setDateException(tx, ctx, est, { date: "2026-12-24", closed: false, slots: [{ opens: "12:00", closes: "18:00" }] }),
    );
    const s = await withTenant(owner, org, (tx, ctx) => getSchedule(tx, ctx, est, { exceptionsFrom: "2026-12-01" }));
    expect(s.exceptions).toEqual([
      { date: "2026-12-24", closed: false, note: null, slots: [{ opensMinute: 720, durationMinutes: 360 }] },
      { date: "2026-12-25", closed: true, note: null, slots: [] },
    ]);

    for (const bad of [
      { date: "2026-02-30", closed: true },
      { date: "2026-12-26", closed: true, slots: [{ opens: "10:00", closes: "12:00" }] },
      { date: "2026-12-26", closed: false, slots: [] },
      { date: "2026-12-26", closed: false, slots: [{ opens: "10:00", closes: "12:00" }, { opens: "11:00", closes: "13:00" }] },
    ]) {
      await expect(withTenant(owner, org, (tx, ctx) => setDateException(tx, ctx, est, bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }

    await withTenant(owner, org, (tx, ctx) => deleteDateException(tx, ctx, est, "2026-12-25"));
    await expect(
      withTenant(owner, org, (tx, ctx) => deleteDateException(tx, ctx, est, "2026-12-25")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("un día cerrado no admite turnos ni siquiera insertándolos directamente", async () => {
    await withTenant(owner, org, (tx, ctx) => setDateException(tx, ctx, est, { date: "2027-01-01", closed: true }));
    await withAdminClient(async (c) => {
      const { rows } = await c.query("SELECT id FROM schedule_exceptions WHERE establishment_id = $1 AND date = '2027-01-01'", [est]);
      await expect(
        c.query(
          "INSERT INTO schedule_exception_slots (organization_id, exception_id, opens_minute, duration_minutes) VALUES ($1, $2, 600, 60)",
          [org, rows[0].id],
        ),
      ).rejects.toThrow(/closed exception cannot have slots/);
    });
  });
});

describe("aislamiento de horarios entre organizaciones", () => {
  let alice: AuthUser;
  let bob: AuthUser;
  let orgA: string;
  let orgB: string;
  let estB: string;

  beforeAll(async () => {
    alice = await createTestUser("sch-alice");
    bob = await createTestUser("sch-bob");
    orgA = await createTestOrganization(alice, "sch-a");
    orgB = await createTestOrganization(bob, "sch-b");
    await withTenant(alice, orgA, (tx, ctx) => createEstablishment(tx, ctx, { name: "A", slug: `a-${uniqueSuffix()}` }));
    estB = (await withTenant(bob, orgB, (tx, ctx) => createEstablishment(tx, ctx, { name: "B", slug: `b-${uniqueSuffix()}` }))).id;
    await withTenant(bob, orgB, (tx, ctx) => setWeeklyHours(tx, ctx, estB, { slots: WEEK }));
    await withTenant(bob, orgB, (tx, ctx) => setDateException(tx, ctx, estB, { date: "2026-12-25", closed: true }));
  });

  it("A no puede leer ni modificar horarios de un establecimiento de B", async () => {
    await expect(withTenant(alice, orgA, (tx, ctx) => getSchedule(tx, ctx, estB))).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(alice, orgA, (tx, ctx) => setWeeklyHours(tx, ctx, estB, { slots: [] })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(alice, orgA, (tx, ctx) => setDateException(tx, ctx, estB, { date: "2026-12-31", closed: true })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(alice, orgA, (tx, ctx) => deleteDateException(tx, ctx, estB, "2026-12-25")),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(withTenant(alice, orgB, (tx, ctx) => getSchedule(tx, ctx, estB))).rejects.toBeInstanceOf(NotFoundError);

    const s = await withTenant(bob, orgB, (tx, ctx) => getSchedule(tx, ctx, estB));
    expect(s.weekly).toHaveLength(3);
    expect(s.exceptions).toHaveLength(1);
  });

  it("el esquema impide asociar un horario de A a un establecimiento de B (FK compuesta)", async () => {
    await withAdminClient(async (c) => {
      await expect(
        c.query(
          `INSERT INTO opening_hours (organization_id, establishment_id, weekday, opens_minute, duration_minutes)
           VALUES ($1, $2, 3, 600, 60)`,
          [orgA, estB],
        ),
      ).rejects.toThrow(/opening_hours_establishment_fk/);
    });
  });

  it("RLS: con el contexto de A no se ven ni se borran filas de B", async () => {
    await withAppClient(async (c: pg.Client) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [alice.id, orgA]);
        for (const t of ["opening_hours", "schedule_exceptions", "schedule_exception_slots"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [orgA]);
          expect(rows[0].n, t).toBe(0);
        }
        const del = await c.query("DELETE FROM opening_hours WHERE establishment_id = $1", [estB]);
        expect(del.rowCount).toBe(0);
        await expect(
          c.query(
            `INSERT INTO opening_hours (organization_id, establishment_id, weekday, opens_minute, duration_minutes)
             VALUES ($1, $2, 3, 600, 60)`,
            [orgB, estB],
          ),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
    const s = await withTenant(bob, orgB, (tx, ctx) => getSchedule(tx, ctx, estB));
    expect(s.weekly).toHaveLength(3);
  });
});
