import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, ForbiddenError, RateLimitedError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import {
  bookPublic,
  getPublicBookingInfo,
  listPublicSlots,
  PUBLIC_RATE_LIMITS,
  type PublicBookingInfo,
} from "@/server/modules/public-booking/service";
import { listReservationsForDay } from "@/server/modules/reservations/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { addDays, localDateOf } from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const TZ = "Europe/Madrid";
const DATE = localDateOf(new Date(Date.now() + 3 * 86_400_000), TZ);

const SETTINGS = {
  publicEnabled: true,
  minParty: 1,
  maxParty: 6,
  durationMinutes: 90,
  slotIntervalMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
  autoConfirm: true,
};

interface Fixture {
  owner: AuthUser;
  org: string;
  orgSlug: string;
  est: string;
  estSlug: string;
  tables: string[];
}

async function setup(label: string, capacities = [4, 4], settings: Partial<typeof SETTINGS> = {}): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const { rows } = await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]));
  const estSlug = `local-${uniqueSuffix()}`;
  return withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug, timezone: TZ })).id;
    const slots = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      slots.push({ weekday, opens: "13:00", closes: "16:00" }, { weekday, opens: "20:00", closes: "00:00" });
    }
    await setWeeklyHours(tx, ctx, est, { slots });
    const zone = await createZone(tx, ctx, est, { name: "Comedor" });
    const tables = [];
    for (const [i, max] of capacities.entries()) {
      tables.push((await createTable(tx, ctx, zone, { name: `T${i + 1}`, minCapacity: 1, maxCapacity: max })).id);
    }
    await updateReservationSettings(tx, ctx, est, { ...SETTINGS, ...settings });
    return { owner, org, orgSlug: rows[0].slug, est, estSlug, tables };
  });
}

let counter = 0;
function request(over: Record<string, unknown> = {}) {
  counter++;
  return {
    date: DATE,
    time: "21:00",
    partySize: 2,
    customerName: "Cliente Web",
    customerPhone: "",
    customerEmail: `cliente${counter}-${uniqueSuffix()}@example.test`,
    notes: "",
    consent: true,
    website: "",
    idempotencyKey: randomUUID(),
    ...over,
  };
}

async function info(f: Fixture): Promise<PublicBookingInfo> {
  return (await getPublicBookingInfo(f.orgSlug, f.estSlug))!;
}

describe("reserva pública", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("pub");
  });

  it("solo existe si el local la activa", async () => {
    const off = await setup("pub-off", [4], { publicEnabled: false });
    expect(await getPublicBookingInfo(off.orgSlug, off.estSlug)).toBeNull();
    expect(await getPublicBookingInfo(f.orgSlug, "no-existe")).toBeNull();
    expect(await getPublicBookingInfo("../x", f.estSlug)).toBeNull();
    expect(await info(f)).toMatchObject({ establishmentName: "Local", maxParty: 6, durationMinutes: 90 });
  });

  it("ofrece horas que caben en el horario de apertura", async () => {
    const { slots } = await listPublicSlots(await info(f), DATE, 2);
    expect(slots).toEqual(["13:00", "13:30", "14:00", "14:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30"]);
    expect((await listPublicSlots(await info(f), DATE, 7)).slots).toEqual([]); // más que el máximo online
    expect((await listPublicSlots(await info(f), addDays(DATE, 40), 2)).slots).toEqual([]); // fuera de días vista
  });

  it("crea la reserva con mesa asignada y la ve el personal", async () => {
    const r = await bookPublic(await info(f), request({ customerName: "Elena Web", partySize: 3 }), "1.2.3.4");
    expect(r.code).toMatch(/^[0-9A-F]{10}$/);
    expect(r.status).toBe("confirmed");
    const day = await withTenant(f.owner, f.org, (tx, ctx) => listReservationsForDay(tx, ctx, f.est, DATE));
    const mine = day.reservations.find((x) => x.customerName === "Elena Web")!;
    expect(mine.tables).toHaveLength(1);
    expect(mine.partySize).toBe(3);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT source, public_code, consent_at FROM reservations WHERE id = $1", [mine.id]),
    );
    expect(rows[0]).toMatchObject({ source: "public", public_code: r.code });
    expect(rows[0].consent_at).not.toBeNull();
  });

  it("un reenvío con la misma clave devuelve la misma reserva", async () => {
    const req = request({ time: "13:00" });
    const a = await bookPublic(await info(f), req, "1.2.3.5");
    const b = await bookPublic(await info(f), req, "1.2.3.5");
    expect(b.replayed).toBe(true);
    expect(b.code).toBe(a.code);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM reservations WHERE public_code = $1", [a.code]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("valida horario, comensales, contacto, consentimiento y campo trampa", async () => {
    const i = await info(f);
    await expect(bookPublic(i, request({ time: "17:00" }), "9.9.9.1")).rejects.toBeInstanceOf(ConflictError);
    await expect(bookPublic(i, request({ time: "23:00" }), "9.9.9.1")).rejects.toBeInstanceOf(ConflictError); // acabaría a las 00:30
    await expect(bookPublic(i, request({ partySize: 7 }), "9.9.9.1")).rejects.toThrow(/de 1 a 6 comensales/);
    await expect(bookPublic(i, request({ customerEmail: "", customerPhone: "" }), "9.9.9.1")).rejects.toBeInstanceOf(ValidationError);
    await expect(bookPublic(i, request({ consent: false }), "9.9.9.1")).rejects.toBeInstanceOf(ValidationError);
    await expect(bookPublic(i, request({ website: "http://spam.example" }), "9.9.9.1")).rejects.toBeInstanceOf(ValidationError);
    await expect(bookPublic(i, request({ status: "seated" }), "9.9.9.1")).rejects.toBeInstanceOf(ValidationError);
    await expect(bookPublic(i, request({ date: addDays(DATE, 60) }), "9.9.9.1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("con 6 clientes a la vez y 2 mesas libres se aceptan exactamente 2, en mesas distintas", async () => {
    const g = await setup("pub-race", [4, 4]);
    const i = await info(g);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, n) => bookPublic(i, request({ time: "20:30", customerName: `R${n}` }), `10.0.0.${n}`)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ConflictError);
    const day = await withTenant(g.owner, g.org, (tx, ctx) => listReservationsForDay(tx, ctx, g.est, DATE));
    const tablesUsed = day.reservations.flatMap((r) => r.tables.map((t) => t.id));
    expect(new Set(tablesUsed).size).toBe(2);
    expect((await listPublicSlots(i, DATE, 2)).slots).not.toContain("20:30");
  });

  it("limita las solicitudes por cliente", async () => {
    const g = await setup("pub-rate", [4]);
    const i = await info(g);
    for (let n = 0; n < PUBLIC_RATE_LIMITS.perClientPerHour; n++) {
      await expect(bookPublic(i, request({ time: "17:00" }), "203.0.113.7")).rejects.toBeInstanceOf(ConflictError);
    }
    await expect(bookPublic(i, request({ time: "13:00" }), "203.0.113.7")).rejects.toBeInstanceOf(RateLimitedError);
    // Otro cliente no se ve afectado.
    await expect(bookPublic(i, request({ time: "13:00" }), "203.0.113.8")).resolves.toMatchObject({ status: "confirmed" });
    // Solo se guarda el hash del identificador del cliente.
    const { rows } = await withAdminClient((c) => c.query("SELECT bucket FROM rate_limit_hits WHERE bucket LIKE 'pb:client:%'"));
    expect(rows.every((r) => !r.bucket.includes("203.0.113"))).toBe(true);
  });

  it("limita las solicitudes por contacto", async () => {
    const g = await setup("pub-contact", [4, 4, 4, 4, 4, 4]);
    const i = await info(g);
    const email = `repetido-${uniqueSuffix()}@example.test`;
    const times = ["13:00", "13:30", "14:00", "14:30", "20:00"];
    for (const [n, time] of times.entries()) {
      await bookPublic(i, request({ time, customerEmail: email }), `198.51.100.${n}`);
    }
    await expect(bookPublic(i, request({ time: "20:30", customerEmail: email.toUpperCase() }), "198.51.100.99")).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("si el local requiere confirmación, la reserva queda pendiente", async () => {
    const g = await setup("pub-pending", [4], { autoConfirm: false });
    const r = await bookPublic(await info(g), request({ time: "14:00" }), "192.0.2.1");
    expect(r.status).toBe("pending");
  });

  it("las funciones públicas no exponen datos de reservas ni funcionan con la reserva pública desactivada", async () => {
    await bookPublic(await info(f), request({ time: "22:00", customerName: "Dato Privado" }), "192.0.2.50");
    await withAppClient(async (c) => {
      const busy = await c.query("SELECT * FROM app.public_busy($1, now(), now() + interval '60 days')", [f.est]);
      expect(busy.rows.length).toBeGreaterThan(0);
      expect(Object.keys(busy.rows[0]).sort()).toEqual(["ends_at", "starts_at", "table_id"]);
      expect(JSON.stringify(busy.rows)).not.toContain("Dato Privado");
      // Sin contexto, RLS no deja leer reservas.
      const direct = await c.query("SELECT count(*)::int AS n FROM reservations");
      expect(direct.rows[0].n).toBe(0);
      // Ni leer ni escribir directamente el límite de peticiones.
      await expect(c.query("SELECT * FROM rate_limit_hits")).rejects.toThrow(/permission denied/);
    });
    const off = await setup("pub-off2", [4], { publicEnabled: false });
    await withAppClient(async (c) => {
      for (const sql of [
        "SELECT count(*)::int AS n FROM app.public_tables($1)",
        "SELECT count(*)::int AS n FROM app.public_opening_hours($1)",
      ]) {
        const { rows } = await c.query(sql, [off.est]);
        expect(rows[0].n, sql).toBe(0);
      }
      await expect(
        c.query(
          "SELECT * FROM app.public_book($1, now() + interval '3 days', now() + interval '3 days 90 minutes', 2, 'X', null, 'x@example.test', null, $2::uuid[], 'clave-directa-1')",
          [off.est, off.tables],
        ),
      ).rejects.toThrow(/public_booking_disabled/);
    });
  });

  it("no se puede reservar una mesa de otro local llamando directamente a la función", async () => {
    const other = await setup("pub-other", [4]);
    await withAppClient(async (c) => {
      await expect(
        c.query(
          `SELECT * FROM app.public_book($1, $3::timestamptz, $3::timestamptz + interval '90 minutes', 2, 'X', null, 'x@example.test', null, $2::uuid[], 'clave-directa-2')`,
          [f.est, other.tables, new Date(Date.now() + 5 * 86_400_000)],
        ),
      ).rejects.toThrow(/no_availability/);
    });
  });

  it("solo quien puede editar el establecimiento cambia la configuración", async () => {
    const staff = await createTestUser("pub-staff");
    await addMember(f.org, staff, "staff");
    await expect(
      withTenant(staff, f.org, (tx, ctx) => updateReservationSettings(tx, ctx, f.est, SETTINGS)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withTenant(f.owner, f.org, (tx, ctx) => updateReservationSettings(tx, ctx, f.est, { ...SETTINGS, minParty: 5, maxParty: 2 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
