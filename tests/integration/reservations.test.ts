import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone, deleteTable, updateTable } from "@/server/modules/floor/service";
import {
  createReservation,
  findAvailableTables,
  getReservation,
  listReservationsForDay,
  occupancyAt,
  setReservationStatus,
  updateReservation,
} from "@/server/modules/reservations/service";
import { setDateException, setWeeklyHours } from "@/server/modules/schedules/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const DAY = "2026-11-20"; // viernes, horario de invierno (UTC+1)

interface Fixture {
  owner: AuthUser;
  org: string;
  est: string;
  t1: string; // 2-4
  t2: string; // 2-4
  t3: string; // 6-8
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  return withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}`, timezone: "Europe/Madrid" })).id;
    const slots = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      slots.push({ weekday, opens: "13:00", closes: "16:00" }, { weekday, opens: "20:00", closes: "00:30" });
    }
    await setWeeklyHours(tx, ctx, est, { slots });
    const zone = await createZone(tx, ctx, est, { name: "Comedor" });
    const t1 = (await createTable(tx, ctx, zone, { name: "T1", minCapacity: 2, maxCapacity: 4 })).id;
    const t2 = (await createTable(tx, ctx, zone, { name: "T2", minCapacity: 2, maxCapacity: 4 })).id;
    const t3 = (await createTable(tx, ctx, zone, { name: "T3", minCapacity: 6, maxCapacity: 8, width: 3 })).id;
    return { owner, org, est, t1, t2, t3 };
  });
}

function book(f: Fixture, input: Record<string, unknown>, user: AuthUser = f.owner) {
  return withTenant(user, f.org, (tx, ctx) =>
    createReservation(tx, ctx, f.est, { date: DAY, durationMinutes: 90, partySize: 2, customerName: "Cliente", ...input }),
  );
}

describe("reservas", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("res");
  });

  it("crea una reserva en hora local y la lista en su día", async () => {
    const { reservation } = await book(f, { time: "21:00", partySize: 3, tableIds: [f.t1], customerName: "Ana", customerPhone: "600111222" });
    expect(reservation.startsAt.toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(reservation.endsAt.toISOString()).toBe("2026-11-20T21:30:00.000Z");
    expect(reservation.tables.map((t) => t.name)).toEqual(["T1"]);
    expect(reservation.status).toBe("confirmed");
    const day = await withTenant(f.owner, f.org, (tx, ctx) => listReservationsForDay(tx, ctx, f.est, DAY));
    expect(day.reservations.map((r) => r.customerName)).toContain("Ana");
  });

  it("impide dos reservas solapadas en la misma mesa y permite las consecutivas", async () => {
    await expect(book(f, { time: "22:00", tableIds: [f.t1] })).rejects.toBeInstanceOf(ConflictError);
    await expect(book(f, { time: "20:00", durationMinutes: 61, tableIds: [f.t1] })).rejects.toBeInstanceOf(ConflictError);
    // 21:00–22:30 ocupada; 22:30–24:00 libre (intervalos semiabiertos).
    const next = await book(f, { time: "22:30", tableIds: [f.t1] });
    expect(next.reservation.tables).toHaveLength(1);
    const before = await book(f, { time: "20:00", durationMinutes: 60, tableIds: [f.t1] });
    expect(before.reservation.tables).toHaveLength(1);
  });

  it("con peticiones simultáneas para la misma mesa y hora solo una se confirma", async () => {
    const g = await setup("res-race");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => book(g, { time: "13:30", tableIds: [g.t2], customerName: `C${i}` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    const day = await withTenant(g.owner, g.org, (tx, ctx) => listReservationsForDay(tx, ctx, g.est, DAY));
    expect(day.reservations).toHaveLength(1);
  });

  it("solo dentro del horario de apertura (también turnos que pasan de medianoche)", async () => {
    await expect(book(f, { time: "17:00" })).rejects.toThrow(/no está abierto/);
    await expect(book(f, { time: "15:00", durationMinutes: 90 })).rejects.toThrow(/no está abierto/);
    // 23:30–00:30 dentro del turno 20:00–00:30.
    await expect(book(f, { time: "23:30", durationMinutes: 60 })).resolves.toBeTruthy();
    await expect(book(f, { time: "23:30", durationMinutes: 61 })).rejects.toThrow(/no está abierto/);
    // Un día marcado como cerrado.
    await withTenant(f.owner, f.org, (tx, ctx) => setDateException(tx, ctx, f.est, { date: "2026-12-25", closed: true }));
    await expect(book(f, { date: "2026-12-25", time: "14:00" })).rejects.toThrow(/no está abierto/);
  });

  it("valida capacidad, mesas y datos", async () => {
    await expect(book(f, { time: "13:00", partySize: 5, tableIds: [f.t2] })).rejects.toThrow(/admiten 4 personas/);
    // Combinar mesas suma capacidad.
    const combo = await book(f, { time: "13:00", partySize: 8, tableIds: [f.t2, f.t1] });
    expect(combo.reservation.tables.map((t) => t.name)).toEqual(["T1", "T2"]);
    for (const bad of [
      { time: "25:00" },
      { time: "14:00", date: "2026-02-30" },
      { time: "14:00", partySize: 0 },
      { time: "14:00", durationMinutes: 10 },
      { time: "14:00", customerName: "" },
      { time: "14:00", customerEmail: "no-es-correo" },
      { time: "14:00", status: "seated" },
      { time: "14:00", organizationId: f.org },
    ]) {
      await expect(book(f, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    // Una mesa desactivada no se puede reservar.
    await withTenant(f.owner, f.org, (tx, ctx) => updateTable(tx, ctx, f.t3, { active: false }));
    await expect(book(f, { time: "14:00", partySize: 6, tableIds: [f.t3] })).rejects.toThrow(/desactivada/);
  });

  it("estados: cancelar o marcar no presentada libera la mesa; las transiciones se validan", async () => {
    const g = await setup("res-status");
    const a = await book(g, { time: "14:00", tableIds: [g.t1] });
    await expect(book(g, { time: "14:00", tableIds: [g.t1] })).rejects.toBeInstanceOf(ConflictError);
    await withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, a.reservation.id, "cancelled"));
    const b = await book(g, { time: "14:00", tableIds: [g.t1] });
    await withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, b.reservation.id, "no_show"));
    const c = await book(g, { time: "14:00", tableIds: [g.t1], status: "pending" });
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, c.reservation.id, "seated")),
    ).rejects.toThrow(/pendiente no puede pasar a en mesa/);
    await withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, c.reservation.id, "confirmed"));
    await withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, c.reservation.id, "seated"));
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, a.reservation.id, "confirmed")),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, c.reservation.id, "volando")),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("finalizar una reserva en curso la acorta y libera la mesa desde ese momento", async () => {
    const g = await setup("res-complete");
    // Reserva sembrada en el presente (horas de apertura no aplican a datos insertados por el propietario).
    const { rows } = await withAdminClient((c) =>
      c.query(
        `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status, customer_name)
         VALUES ($1, $2, now() - interval '30 minutes', now() + interval '60 minutes', 2, 'seated', 'En curso') RETURNING id`,
        [g.org, g.est],
      ),
    );
    await withAdminClient((c) =>
      c.query(
        `INSERT INTO reservation_tables (organization_id, establishment_id, reservation_id, table_id, during, active)
         VALUES ($1, $2, $3, $4, 'empty', false)`,
        [g.org, g.est, rows[0].id, g.t1],
      ),
    );
    const occBefore = await withTenant(g.owner, g.org, (tx, ctx) => occupancyAt(tx, ctx, g.est, new Date()));
    expect(occBefore.get(g.t1)?.customerName).toBe("En curso");
    const done = await withTenant(g.owner, g.org, (tx, ctx) => setReservationStatus(tx, ctx, rows[0].id, "completed"));
    expect(done.endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const occAfter = await withTenant(g.owner, g.org, (tx, ctx) => occupancyAt(tx, ctx, g.est, new Date(Date.now() + 5 * 60_000)));
    expect(occAfter.has(g.t1)).toBe(false);
  });

  it("modificar horario o mesas respeta los solapes", async () => {
    const g = await setup("res-update");
    const a = await book(g, { time: "13:00", tableIds: [g.t1], customerName: "A" });
    const b = await book(g, { time: "14:30", tableIds: [g.t2], customerName: "B" });
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) =>
        updateReservation(tx, ctx, b.reservation.id, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2, customerName: "B", tableIds: [g.t1] }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const moved = await withTenant(g.owner, g.org, (tx, ctx) =>
      updateReservation(tx, ctx, b.reservation.id, { date: DAY, time: "14:30", durationMinutes: 60, partySize: 2, customerName: "B", tableIds: [g.t1] }),
    );
    expect(moved.tables.map((t) => t.name)).toEqual(["T1"]);
    // Mover la reserva A encima de B (misma mesa) por cambio de hora.
    await expect(
      withTenant(g.owner, g.org, (tx, ctx) =>
        updateReservation(tx, ctx, a.reservation.id, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2, customerName: "A", tableIds: [g.t1] }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const unchanged = await withTenant(g.owner, g.org, (tx, ctx) => getReservation(tx, ctx, a.reservation.id));
    expect(unchanged.startsAt.toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });

  it("disponibilidad: excluye mesas ocupadas y ordena por ajuste de capacidad", async () => {
    const g = await setup("res-avail");
    await book(g, { time: "21:00", tableIds: [g.t1] });
    const { tables } = await withTenant(g.owner, g.org, (tx, ctx) =>
      findAvailableTables(tx, ctx, g.est, { date: DAY, time: "21:30", durationMinutes: 90, partySize: 6 }),
    );
    expect(tables.map((t) => t.name)).toEqual(["T3", "T2"]);
    const later = await withTenant(g.owner, g.org, (tx, ctx) =>
      findAvailableTables(tx, ctx, g.est, { date: DAY, time: "22:30", durationMinutes: 60, partySize: 2 }),
    );
    expect(later.tables.map((t) => t.name).sort()).toEqual(["T1", "T2", "T3"]);
  });

  it("idempotencia: un reenvío con la misma clave no duplica la reserva", async () => {
    const g = await setup("res-idem");
    const key = randomUUID();
    const a = await book(g, { time: "13:00", tableIds: [g.t1], idempotencyKey: key });
    const b = await book(g, { time: "13:00", tableIds: [g.t1], idempotencyKey: key });
    expect(b.replayed).toBe(true);
    expect(b.reservation.id).toBe(a.reservation.id);
    const day = await withTenant(g.owner, g.org, (tx, ctx) => listReservationsForDay(tx, ctx, g.est, DAY));
    expect(day.reservations).toHaveLength(1);
  });

  it("la BD impide desincronizar intervalos o solapar asignaciones directamente", async () => {
    const g = await setup("res-db");
    const a = await book(g, { time: "13:00", tableIds: [g.t1] });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [g.owner.id, g.org]);
      await expect(c.query("UPDATE reservation_tables SET active = false")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [g.owner.id, g.org]);
      await expect(c.query("DELETE FROM reservations")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK");
    });
    // Aunque se intente insertar con un intervalo falso, el trigger usa el de la reserva.
    const b = await book(g, { time: "15:00", durationMinutes: 60 });
    await withAdminClient(async (c) => {
      await c.query(
        `INSERT INTO reservation_tables (organization_id, establishment_id, reservation_id, table_id, during, active)
         VALUES ($1, $2, $3, $4, tstzrange('2000-01-01', '2000-01-02'), false)`,
        [g.org, g.est, b.reservation.id, g.t1],
      );
      const { rows } = await c.query("SELECT lower(during) AS s, active FROM reservation_tables WHERE reservation_id = $1", [b.reservation.id]);
      expect(rows[0].active).toBe(true);
      expect(new Date(rows[0].s).toISOString()).toBe("2026-11-20T14:00:00.000Z");
      await expect(
        c.query("UPDATE reservations SET starts_at = $2, ends_at = $3 WHERE id = $1", [
          b.reservation.id,
          "2026-11-20T12:30:00Z",
          "2026-11-20T13:30:00Z",
        ]),
      ).rejects.toThrow(/reservation_tables_no_overlap/);
    });
    expect(a.reservation.tables).toHaveLength(1);
    // Una mesa con reservas no se puede eliminar.
    await expect(withTenant(g.owner, g.org, (tx, ctx) => deleteTable(tx, ctx, g.t1))).rejects.toThrow(/tiene reservas/);
  });
});

describe("reservas: permisos y aislamiento", () => {
  it("el personal gestiona reservas", async () => {
    const f = await setup("res-staff");
    const staff = await createTestUser("res-staff-user");
    await addMember(f.org, staff, "staff");
    const { reservation } = await book(f, { time: "14:00", tableIds: [f.t1] }, staff);
    await withTenant(staff, f.org, (tx, ctx) => setReservationStatus(tx, ctx, reservation.id, "seated"));
  });

  it("A no ve ni modifica reservas de B ni usa mesas de B o de otro local", async () => {
    const a = await setup("res-a");
    const b = await setup("res-b");
    const rb = (await book(b, { time: "14:00", tableIds: [b.t1], customerName: "Privado" })).reservation;
    for (const op of [
      (tx: never, ctx: never) => getReservation(tx, ctx, rb.id),
      (tx: never, ctx: never) => setReservationStatus(tx, ctx, rb.id, "cancelled"),
      (tx: never, ctx: never) => updateReservation(tx, ctx, rb.id, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2, customerName: "X" }),
      (tx: never, ctx: never) => listReservationsForDay(tx, ctx, b.est, DAY),
      (tx: never, ctx: never) => findAvailableTables(tx, ctx, b.est, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2 }),
      (tx: never, ctx: never) => createReservation(tx, ctx, b.est, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2, customerName: "X" }),
      (tx: never, ctx: never) => createReservation(tx, ctx, a.est, { date: DAY, time: "14:00", durationMinutes: 60, partySize: 2, customerName: "X", tableIds: [b.t1] }),
      (tx: never, ctx: never) => occupancyAt(tx, ctx, b.est, new Date()),
    ]) {
      await expect(withTenant(a.owner, a.org, op as never)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Mesa de otro establecimiento de la misma organización.
    const otherEstTable = await withTenant(a.owner, a.org, async (tx, ctx) => {
      const e = await createEstablishment(tx, ctx, { name: "Otro", slug: `otro-${uniqueSuffix()}` });
      const z = await createZone(tx, ctx, e.id, { name: "Sala" });
      return (await createTable(tx, ctx, z, { name: "X1", maxCapacity: 4 })).id;
    });
    await expect(book(a, { time: "14:00", tableIds: [otherEstTable] })).rejects.toBeInstanceOf(NotFoundError);
    await withAdminClient(async (c) => {
      const { rows } = await c.query("SELECT id FROM reservations WHERE establishment_id = $1 LIMIT 1", [b.est]);
      await expect(
        c.query(
          `INSERT INTO reservation_tables (organization_id, establishment_id, reservation_id, table_id, during, active)
           VALUES ($1, $2, $3, $4, 'empty', false)`,
          [b.org, b.est, rows[0].id, a.t1],
        ),
      ).rejects.toThrow(/reservation_tables_table_fk/);
    });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [a.owner.id, a.org]);
        for (const t of ["reservations", "reservation_tables"]) {
          const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id <> $1`, [a.org]);
          expect(rows[0].n, t).toBe(0);
        }
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });
});
