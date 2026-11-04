import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { submitContactMessage } from "@/server/modules/contact/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { exportCsv } from "@/server/modules/exports/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import { createIngredient, createWarehouse, recordMovement } from "@/server/modules/inventory/service";
import { setMemberEstablishments } from "@/server/modules/members/service";
import { createReservation } from "@/server/modules/reservations/service";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import { createShift, createStaffMember } from "@/server/modules/staff/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

/** Filas del CSV sin la marca UTF-8 ni la última línea vacía. */
function lines(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter(Boolean)
    .map((l) => l.split(";"));
}

// Exportaciones a CSV (D-058).
describe("exportaciones CSV", () => {
  let owner: AuthUser;
  let manager: AuthUser; // encargado, solo Centro
  let waiter: AuthUser; // personal
  let org: string;
  let centro: string;
  let playa: string;
  const as =
    (u: AuthUser) =>
    <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) =>
      withTenant(u, org, fn);
  const range = { from: "2027-05-01", to: "2027-05-31" };

  beforeAll(async () => {
    owner = await createTestUser("exp-owner");
    manager = await createTestUser("exp-manager");
    waiter = await createTestUser("exp-waiter");
    org = await createTestOrganization(owner, "exportar");
    await addMember(org, manager, "manager");
    await addMember(org, waiter, "staff");
    await as(owner)(async (tx, ctx) => {
      centro = (await createEstablishment(tx, ctx, { name: "Centro", slug: `centro-${uniqueSuffix()}` })).id;
      playa = (await createEstablishment(tx, ctx, { name: "Playa", slug: `playa-${uniqueSuffix()}` })).id;
      // Abiertos todos los días de 12:00 a 01:00 (las reservas exigen horario).
      const slots = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: "12:00", closes: "01:00" }));
      for (const est of [centro, playa]) await setWeeklyHours(tx, ctx, est, { slots });
      const zone = await createZone(tx, ctx, centro, { name: "Comedor" });
      const t1 = (await createTable(tx, ctx, zone, { name: "T1", maxCapacity: 4 })).id;
      // 31 de mayo a las 23:30 en Madrid es ya 1 de junio en UTC: cuenta como día 31.
      await createReservation(tx, ctx, centro, {
        date: "2027-05-31",
        time: "23:30",
        durationMinutes: 60,
        partySize: 2,
        customerName: "=HYPERLINK(\"http://evil\")",
        customerPhone: "+34 600 111 222",
        notes: "Alergia; frutos secos",
        tableIds: [t1],
      });
      await createReservation(tx, ctx, centro, {
        date: "2027-06-01",
        time: "13:00",
        durationMinutes: 60,
        partySize: 4,
        customerName: "Fuera del periodo",
      });
      await createReservation(tx, ctx, playa, {
        date: "2027-05-10",
        time: "14:00",
        durationMinutes: 60,
        partySize: 3,
        customerName: "Cliente Playa",
      });
      const ana = (await createStaffMember(tx, ctx, { name: "Ana", position: "Sala", userId: "" })).id;
      await createShift(tx, ctx, centro, {
        staffMemberId: ana,
        date: "2027-05-14",
        start: "20:00",
        end: "01:30",
        position: "",
        notes: "",
      });
      const wh = await createWarehouse(tx, ctx, centro, { name: "Cámara" });
      const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g", reorderLevel: "2000" })).id;
      await recordMovement(tx, ctx, {
        warehouseId: wh,
        ingredientId: flour,
        kind: "receipt",
        quantity: "1,5",
        unit: "kg",
        idempotencyKey: randomUUID(),
      });
      await updateSiteProfile(tx, ctx, centro, {
        theme: "clasico",
        tagline: "",
        heroEyebrow: "",
        heroTitle: "Hola",
        heroText: "",
        phone: "",
        whatsapp: "",
        instagram: "",
        highlights: [],
        featuredMenuId: null,
      });
      await setSitePublished(tx, ctx, centro, { published: true });
    });
    await submitContactMessage(
      centro,
      {
        customerName: "Laura",
        customerPhone: "",
        customerEmail: `laura-${uniqueSuffix()}@example.test`,
        message: "¿Tenéis terraza?",
        consent: true,
        website: "",
        idempotencyKey: randomUUID(),
        topic: "event",
      },
      "10.9.0.1",
    );
    // Los movimientos y mensajes se crean ahora: se fechan en mayo de 2027 para el periodo de la prueba.
    await withAdminClient(async (c) => {
      await c.query("UPDATE stock_movements SET created_at = '2027-05-20T10:00:00Z' WHERE organization_id = $1", [org]);
      await c.query("UPDATE contact_messages SET created_at = '2027-05-21T09:15:00Z' WHERE organization_id = $1", [org]);
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

  it("reservas: periodo en la hora del local, mesas, contacto y fórmulas neutralizadas", async () => {
    const file = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "reservations", { establishmentId: centro, ...range }));
    expect(file.filename).toMatch(/^reservas-centro-[a-z0-9]+-2027-05-01_2027-05-31\.csv$/);
    expect(file.csv.startsWith("﻿Local;Fecha;Hora;Hasta;Comensales;Estado;Nombre;")).toBe(true);
    expect(file.rows).toBe(1);
    expect(file.csv).toContain(`Centro;2027-05-31;23:30;00:30;2;Confirmada;"'=HYPERLINK(""http://evil"")";'+34 600 111 222;;"Alergia; frutos secos";T1;Panel;`);
    // Todos los locales: también la de Playa.
    const all = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "reservations", { establishmentId: "", ...range }));
    expect(lines(all.csv).map((l) => l[0])).toEqual(["Local", "Playa", "Centro"]);
  });

  it("mensajes, turnos (de madrugada), stock sin periodo y movimientos", async () => {
    const messages = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "messages", range));
    expect(lines(messages.csv)[1]).toEqual(
      expect.arrayContaining(["Centro", "2027-05-21 11:15", "Evento o celebración", "Laura", "¿Tenéis terraza?", "Sin leer"]),
    );
    const shifts = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "shifts", range));
    expect(lines(shifts.csv)[1]).toEqual(["Centro", "Ana", "Sala", "2027-05-14", "20:00", "01:30", "5,5", ""]);
    const stock = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "stock", {}));
    expect(lines(stock.csv)[1]).toEqual(["Centro", "Cámara", "Harina", "1500", "g", "2000", "Sí"]);
    const movements = await as(owner)((tx, ctx) => exportCsv(tx, ctx, "movements", range));
    expect(lines(movements.csv)[1]).toEqual(
      expect.arrayContaining(["Centro", "Cámara", "2027-05-20 12:00", "Harina", "Entrada", "1500", "g"]),
    );
  });

  it("valida el periodo y rechaza campos no previstos", async () => {
    const rejects = (input: Record<string, unknown>) =>
      expect(as(owner)((tx, ctx) => exportCsv(tx, ctx, "reservations", input))).rejects.toThrow(ValidationError);
    await rejects({});
    await rejects({ from: "2027-05-31", to: "2027-05-01" });
    await rejects({ from: "2026-01-01", to: "2027-01-02" });
    await rejects({ from: "2027-02-30", to: "2027-03-01" });
    await rejects({ ...range, organizationId: org });
  });

  it("permisos: el personal no exporta; el encargado solo ve su local; queda en la auditoría", async () => {
    await expect(
      withTenant(waiter, org, (tx, ctx) => exportCsv(tx, ctx, "reservations", range)),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      withTenant(manager, org, (tx, ctx) => exportCsv(tx, ctx, "reservations", { establishmentId: playa, ...range })),
    ).rejects.toThrow(NotFoundError);
    const mine = await withTenant(manager, org, (tx, ctx) => exportCsv(tx, ctx, "reservations", range));
    expect(lines(mine.csv).map((l) => l[0])).toEqual(["Local", "Centro"]);
    const { rows } = await withAdminClient((c) =>
      c.query(
        "SELECT metadata FROM audit_events WHERE organization_id = $1 AND action = 'data.exported' AND actor_user_id = $2",
        [org, manager.id],
      ),
    );
    expect(rows.at(-1)?.metadata).toMatchObject({ kind: "reservations", rows: 1, from: range.from, to: range.to });
  });

  it("aislamiento y plan: otra organización no ve nada; en Básico no se exporta", async () => {
    const outsider = await createTestUser("exp-out");
    const other = await createTestOrganization(outsider, "ajena");
    const theirs = await withTenant(outsider, other, (tx, ctx) => exportCsv(tx, ctx, "reservations", range));
    expect(theirs.rows).toBe(0);
    await expect(
      withTenant(outsider, other, (tx, ctx) => exportCsv(tx, ctx, "reservations", { establishmentId: centro, ...range })),
    ).rejects.toThrow(NotFoundError);
    const basic = await createTestOrganization(outsider, "basica", "basic");
    await expect(withTenant(outsider, basic, (tx, ctx) => exportCsv(tx, ctx, "messages", range))).rejects.toThrow(
      ForbiddenError,
    );
  });
});
