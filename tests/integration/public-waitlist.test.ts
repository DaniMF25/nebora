import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { RateLimitedError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import {
  getPublicBookingInfo,
  joinPublicWaitlist,
  PUBLIC_RATE_LIMITS,
  waitlistWindow,
} from "@/server/modules/public-booking/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { addDays, localDateOf } from "@/server/modules/schedules/time";
import { listWaitlist } from "@/server/modules/waitlist/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const TZ = "Europe/Madrid";
const DATE = localDateOf(new Date(Date.now() + 3 * 86_400_000), TZ);

// Lista de espera desde la web (D-042).
describe("lista de espera desde la web", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: string;
  let estSlug: string;
  const info = async () => (await getPublicBookingInfo(orgSlug, estSlug))!;
  const request = (over: Record<string, unknown> = {}) => ({
    date: DATE,
    from: "20:00",
    to: "22:00",
    partySize: 2,
    customerName: "Lucía Web",
    customerPhone: "",
    customerEmail: `lucia-${uniqueSuffix()}@example.test`,
    notes: "",
    consent: true,
    website: "",
    idempotencyKey: randomUUID(),
    ...over,
  });

  beforeAll(async () => {
    owner = await createTestUser("wl-owner");
    org = await createTestOrganization(owner, "EsperaWeb");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    estSlug = `local-${uniqueSuffix()}`;
    est = await withTenant(owner, org, async (tx, ctx) => {
      const id = (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug, timezone: TZ })).id;
      const slots = [];
      for (let weekday = 1; weekday <= 7; weekday++) slots.push({ weekday, opens: "20:00", closes: "23:30" });
      await setWeeklyHours(tx, ctx, id, { slots });
      const zone = await createZone(tx, ctx, id, { name: "Comedor" });
      await createTable(tx, ctx, zone, { name: "T1", minCapacity: 1, maxCapacity: 4 });
      await updateReservationSettings(tx, ctx, id, {
        publicEnabled: true,
        minParty: 1,
        maxParty: 4,
        durationMinutes: 90,
        slotIntervalMinutes: 30,
        minNoticeMinutes: 60,
        maxDaysAhead: 30,
        autoConfirm: true,
      });
      return id;
    });
  });

  it("propone la franja de apertura del día", async () => {
    expect(await waitlistWindow(await info(), DATE)).toEqual({ from: "20:00", to: "23:30" });
  });

  it("apunta al cliente; el personal lo ve como «web» y un reenvío no lo duplica", async () => {
    const req = request();
    const a = await joinPublicWaitlist(await info(), req, "10.1.0.1");
    expect(a).toMatchObject({ date: DATE, from: "20:00", to: "22:00", partySize: 2, replayed: false });
    const b = await joinPublicWaitlist(await info(), req, "10.1.0.1");
    expect(b.replayed).toBe(true);
    const list = await withTenant(owner, org, (tx, ctx) => listWaitlist(tx, ctx, est, DATE));
    const mine = list.filter((w) => w.customerName === "Lucía Web");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: "public", status: "waiting", windowStart: "20:00", windowEnd: "22:00" });
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT consent_at FROM waitlist_entries WHERE id = $1", [mine[0]!.id]),
    );
    expect(rows[0].consent_at).not.toBeNull();
  });

  it("valida comensales, fechas, franja, contacto, consentimiento y campo trampa", async () => {
    const i = await info();
    const rejects = (over: Record<string, unknown>) =>
      expect(joinPublicWaitlist(i, request(over), "10.1.0.2")).rejects.toThrow(ValidationError);
    await rejects({ partySize: 6 });
    await rejects({ date: addDays(DATE, 40) });
    await rejects({ date: addDays(DATE, -10) });
    await rejects({ from: "10:00", to: "12:00" }); // no abre
    await rejects({ from: "22:00", to: "21:00" });
    await rejects({ customerEmail: "", customerPhone: "" });
    await rejects({ consent: false });
    await rejects({ website: "https://spam.example" });
  });

  it("no funciona con la reserva online desactivada y respeta los límites", async () => {
    await withAdminClient((c) =>
      c.query("UPDATE reservation_settings SET public_enabled = false WHERE establishment_id = $1", [est]),
    );
    expect(await getPublicBookingInfo(orgSlug, estSlug)).toBeNull();
    await withAdminClient((c) =>
      c.query("UPDATE reservation_settings SET public_enabled = true WHERE establishment_id = $1", [est]),
    );
    // Mismo contacto muchas veces en un día: límite por contacto.
    const email = `repite-${uniqueSuffix()}@example.test`;
    const i = await info();
    for (let n = 0; n < PUBLIC_RATE_LIMITS.perContactPerDay; n++) {
      await joinPublicWaitlist(i, request({ customerEmail: email }), `10.1.1.${n}`);
    }
    await expect(joinPublicWaitlist(i, request({ customerEmail: email }), "10.1.2.1")).rejects.toThrow(
      RateLimitedError,
    );
  });
});
