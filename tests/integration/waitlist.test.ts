import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import {
  applyRetention,
  eraseCustomerData,
  exportCustomerData,
  findCustomerWaitlist,
} from "@/server/modules/privacy/service";
import { createReservation } from "@/server/modules/reservations/service";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import {
  addWaitlistEntry,
  cancelWaitlistEntry,
  convertWaitlistEntry,
  listWaitlist,
} from "@/server/modules/waitlist/service";
import { withTenant } from "@/server/tenancy/context";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const DAY = "2026-11-20";

interface Fixture {
  owner: AuthUser;
  staff: AuthUser;
  org: string;
  est: string;
  t1: string;
  t2: string;
}

async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const staff = await createTestUser(`${label}-staff`);
  const org = await createTestOrganization(owner, label);
  await addMember(org, staff, "staff");
  return withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: `local-${uniqueSuffix()}` })).id;
    const slots = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: "20:00", closes: "23:30" }));
    await setWeeklyHours(tx, ctx, est, { slots });
    const zone = await createZone(tx, ctx, est, { name: "Sala" });
    const t1 = (await createTable(tx, ctx, zone, { name: "T1", minCapacity: 1, maxCapacity: 4 })).id;
    const t2 = (await createTable(tx, ctx, zone, { name: "T2", minCapacity: 1, maxCapacity: 4 })).id;
    // Ambas mesas ocupadas de 20:00 a 22:00.
    for (const t of [t1, t2]) {
      await createReservation(tx, ctx, est, {
        date: DAY,
        time: "20:00",
        durationMinutes: 120,
        partySize: 4,
        customerName: "Ocupada",
        tableIds: [t],
      });
    }
    return { owner, staff, org, est, t1, t2 };
  });
}

const entry = (over: Record<string, unknown> = {}) => ({
  date: DAY,
  from: "20:00",
  to: "23:00",
  partySize: 2,
  customerName: "Lucía",
  customerPhone: "+34 600 111 222",
  ...over,
});

describe("lista de espera", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup("wl");
  });

  it("valida contacto, franja y pertenencia", async () => {
    const add = (input: Record<string, unknown>, user = f.staff, org = f.org, est = f.est) =>
      withTenant(user, org, (tx, ctx) => addWaitlistEntry(tx, ctx, est, input));
    await expect(add(entry({ customerPhone: "" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(add(entry({ from: "22:00", to: "21:00" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(add(entry({ from: "24:00" }))).rejects.toBeInstanceOf(ValidationError);
    await expect(add(entry({ organizationId: f.org }))).rejects.toBeInstanceOf(ValidationError);
    const other = await setup("wl-other");
    await expect(add(entry(), other.owner, other.org, f.est)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("indica la primera hora con mesa libre dentro de la franja", async () => {
    const wide = await withTenant(f.staff, f.org, (tx, ctx) => addWaitlistEntry(tx, ctx, f.est, entry()));
    const narrow = await withTenant(f.staff, f.org, (tx, ctx) =>
      addWaitlistEntry(tx, ctx, f.est, entry({ customerName: "Pedro", from: "20:00", to: "21:00" })),
    );
    const list = await withTenant(f.staff, f.org, (tx, ctx) => listWaitlist(tx, ctx, f.est, DAY));
    expect(list.find((e) => e.id === wide.id)?.availableAt).toBe("22:00");
    expect(list.find((e) => e.id === narrow.id)?.availableAt).toBeNull();
    expect(list.find((e) => e.id === wide.id)).toMatchObject({
      windowStart: "20:00",
      windowEnd: "23:00",
      status: "waiting",
    });
  });

  it("convierte en reserva confirmada de forma atómica y solo una vez", async () => {
    const e = await withTenant(f.staff, f.org, (tx, ctx) =>
      addWaitlistEntry(
        tx,
        ctx,
        f.est,
        entry({ customerName: "Ana", customerEmail: "Ana@Example.test", notes: "Celíaca" }),
      ),
    );
    // Sin mesa a esa hora: error y la entrada sigue en espera.
    await expect(
      withTenant(f.staff, f.org, (tx, ctx) =>
        convertWaitlistEntry(tx, ctx, e.id, { time: "20:30", durationMinutes: 90 }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const reservation = await withTenant(f.staff, f.org, (tx, ctx) =>
      convertWaitlistEntry(tx, ctx, e.id, { time: "22:00", durationMinutes: 90 }),
    );
    expect(reservation).toMatchObject({
      status: "confirmed",
      partySize: 2,
      customerName: "Ana",
      customerEmail: "ana@example.test",
      notes: "Celíaca",
    });
    expect(reservation.tables).toHaveLength(1);
    const list = await withTenant(f.staff, f.org, (tx, ctx) => listWaitlist(tx, ctx, f.est, DAY));
    expect(list.find((x) => x.id === e.id)).toMatchObject({ status: "converted", reservationId: reservation.id });
    await expect(
      withTenant(f.staff, f.org, (tx, ctx) =>
        convertWaitlistEntry(tx, ctx, e.id, { time: "22:00", durationMinutes: 90 }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("dos conversiones simultáneas por la última mesa: una reserva y la otra sigue en espera", async () => {
    const g = await setup("wl-race");
    // Dejar solo T2 libre a las 22:00.
    await withTenant(g.owner, g.org, (tx, ctx) =>
      createReservation(tx, ctx, g.est, {
        date: DAY,
        time: "22:00",
        durationMinutes: 90,
        partySize: 2,
        customerName: "X",
        tableIds: [g.t1],
      }),
    );
    const [a, b] = await Promise.all(
      ["A", "B"].map((n) =>
        withTenant(g.staff, g.org, (tx, ctx) => addWaitlistEntry(tx, ctx, g.est, entry({ customerName: n }))),
      ),
    );
    const results = await Promise.allSettled(
      [a!, b!].map((e) =>
        withTenant(g.staff, g.org, (tx, ctx) =>
          convertWaitlistEntry(tx, ctx, e.id, { time: "22:00", durationMinutes: 90 }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected && rejected.status === "rejected" && rejected.reason).toBeInstanceOf(ConflictError);
    const list = await withTenant(g.staff, g.org, (tx, ctx) => listWaitlist(tx, ctx, g.est, DAY));
    expect(list.map((e) => e.status).sort()).toEqual(["converted", "waiting"]);
  });

  it("cancelar la deja fuera; otra organización no puede tocarla", async () => {
    const e = await withTenant(f.staff, f.org, (tx, ctx) =>
      addWaitlistEntry(tx, ctx, f.est, entry({ customerName: "Cancela" })),
    );
    const other = await setup("wl-other2");
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) => cancelWaitlistEntry(tx, ctx, e.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      withTenant(other.owner, other.org, (tx, ctx) =>
        convertWaitlistEntry(tx, ctx, e.id, { time: "22:00", durationMinutes: 90 }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await withTenant(f.staff, f.org, (tx, ctx) => cancelWaitlistEntry(tx, ctx, e.id));
    await expect(withTenant(f.staff, f.org, (tx, ctx) => cancelWaitlistEntry(tx, ctx, e.id))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("lista de espera y privacidad", () => {
  it("se exporta, se borra y se anonimiza con la retención", async () => {
    const f = await setup("wl-priv");
    const phone = `+34 611 ${Math.floor(100000 + Math.random() * 899999)}`;
    await withTenant(f.staff, f.org, (tx, ctx) =>
      addWaitlistEntry(tx, ctx, f.est, entry({ customerName: "Rosa", customerPhone: phone, notes: "Ventana" })),
    );
    const found = await withTenant(f.owner, f.org, (tx, ctx) => findCustomerWaitlist(tx, ctx, phone));
    expect(found).toHaveLength(1);
    const exported = await withTenant(f.owner, f.org, (tx, ctx) => exportCustomerData(tx, ctx, phone));
    expect(exported.waitlist).toEqual([expect.objectContaining({ name: "Rosa", notes: "Ventana", status: "waiting" })]);

    await withTenant(f.owner, f.org, (tx, ctx) => eraseCustomerData(tx, ctx, phone));
    expect(await withTenant(f.owner, f.org, (tx, ctx) => findCustomerWaitlist(tx, ctx, phone))).toHaveLength(0);
    const list = await withTenant(f.owner, f.org, (tx, ctx) => listWaitlist(tx, ctx, f.est, DAY));
    expect(list.find((e) => e.customerName === "Cliente anonimizado")).toMatchObject({
      status: "cancelled",
      customerPhone: null,
      notes: null,
    });

    // Retención: una entrada de hace años se anonimiza.
    await withTenant(f.staff, f.org, (tx, ctx) =>
      addWaitlistEntry(
        tx,
        ctx,
        f.est,
        entry({ date: "2020-01-10", customerName: "Antiguo", customerPhone: "600999888" }),
      ),
    );
    const n = await withTenant(f.owner, f.org, (tx, ctx) => applyRetention(tx, ctx));
    expect(n).toBeGreaterThanOrEqual(1);
    const old = await withTenant(f.owner, f.org, (tx, ctx) => listWaitlist(tx, ctx, f.est, "2020-01-10"));
    expect(old[0]).toMatchObject({ customerName: "Cliente anonimizado", customerPhone: null, status: "cancelled" });
  });
});
