import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import {
  bookPublic,
  cancelPublicReservation,
  getPublicBookingInfo,
  getPublicCancellation,
  listPublicSlots,
} from "@/server/modules/public-booking/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { localDateOf } from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const TZ = "Europe/Madrid";
const DATE = localDateOf(new Date(Date.now() + 3 * 86_400_000), TZ);

interface Fixture {
  owner: AuthUser;
  org: string;
  orgSlug: string;
  estSlug: string;
}

/** Local con una sola mesa (así se ve si la cancelación la libera). */
async function setup(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
    .slug;
  const estSlug = `local-${uniqueSuffix()}`;
  await withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug, timezone: TZ })).id;
    const slots = [];
    for (let weekday = 1; weekday <= 7; weekday++) slots.push({ weekday, opens: "20:00", closes: "23:30" });
    await setWeeklyHours(tx, ctx, est, { slots });
    const zone = await createZone(tx, ctx, est, { name: "Comedor" });
    await createTable(tx, ctx, zone, { name: "T1", minCapacity: 1, maxCapacity: 4 });
    await updateReservationSettings(tx, ctx, est, {
      publicEnabled: true,
      minParty: 1,
      maxParty: 4,
      durationMinutes: 90,
      slotIntervalMinutes: 30,
      minNoticeMinutes: 60,
      maxDaysAhead: 30,
      autoConfirm: true,
    });
  });
  return { owner, org, orgSlug, estSlug };
}

function request(over: Record<string, unknown> = {}) {
  return {
    date: DATE,
    time: "21:00",
    partySize: 2,
    customerName: "Cliente Web",
    customerPhone: "",
    customerEmail: `cliente-${uniqueSuffix()}@example.test`,
    notes: "",
    consent: true,
    website: "",
    idempotencyKey: randomUUID(),
    ...over,
  };
}

// Cancelación por el cliente con su enlace (D-041).
describe("cancelación de reservas online por el cliente", () => {
  let f: Fixture;
  let other: Fixture;
  const info = async (x: Fixture) => (await getPublicBookingInfo(x.orgSlug, x.estSlug))!;
  const statusOf = async (code: string) =>
    (await withAdminClient((c) => c.query("SELECT status FROM reservations WHERE public_code = $1", [code]))).rows[0]
      .status;

  beforeAll(async () => {
    f = await setup("cancel");
    other = await setup("cancel-other");
  });

  it("el enlace muestra la reserva, la cancela y libera la mesa", async () => {
    const r = await bookPublic(await info(f), request(), "10.0.0.1");
    expect(r.cancelToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Solo se guarda la huella del token.
    const stored = await withAdminClient((c) =>
      c.query("SELECT cancel_token_hash FROM reservations WHERE public_code = $1", [r.code]),
    );
    expect(stored.rows[0].cancel_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0].cancel_token_hash).not.toContain(r.cancelToken);
    expect((await listPublicSlots(await info(f), DATE, 2)).slots).not.toContain("21:00");

    expect(await getPublicCancellation(f.orgSlug, f.estSlug, r.cancelToken)).toMatchObject({
      code: r.code,
      partySize: 2,
      status: "confirmed",
    });
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, r.cancelToken)).toBe("cancelled");
    expect(await statusOf(r.code)).toBe("cancelled");
    expect((await listPublicSlots(await info(f), DATE, 2)).slots).toContain("21:00");
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, r.cancelToken)).toBe("already_cancelled");
    const audit = await withAdminClient((c) =>
      c.query(
        "SELECT 1 FROM audit_events WHERE organization_id = $1 AND action = 'reservation.cancelled_by_customer'",
        [f.org],
      ),
    );
    expect(audit.rowCount).toBe(1);
  });

  it("un token no sirve en otro local, ni uno inventado o mal formado", async () => {
    const r = await bookPublic(await info(f), request({ time: "20:00" }), "10.0.0.2");
    expect(await getPublicCancellation(other.orgSlug, other.estSlug, r.cancelToken)).toBeNull();
    expect(await cancelPublicReservation(other.orgSlug, other.estSlug, r.cancelToken)).toBe("not_found");
    const forged = "A".repeat(43);
    expect(await getPublicCancellation(f.orgSlug, f.estSlug, forged)).toBeNull();
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, forged)).toBe("not_found");
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, "../../x")).toBe("not_found");
    expect(await statusOf(r.code)).toBe("confirmed");
  });

  it("no cancela si ya empezó o si el cliente ya está en mesa; aunque se desactive la reserva online, sí", async () => {
    const late = await bookPublic(await info(f), request({ time: "22:00" }), "10.0.0.3");
    await withAdminClient((c) =>
      c.query(
        "UPDATE reservations SET starts_at = now() - interval '10 minutes', ends_at = now() + interval '80 minutes' WHERE public_code = $1",
        [late.code],
      ),
    );
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, late.cancelToken)).toBe("too_late");
    await withAdminClient((c) =>
      c.query("UPDATE reservations SET status = 'seated' WHERE public_code = $1", [late.code]),
    );
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, late.cancelToken)).toBe("not_cancellable");

    const next = await bookPublic(await info(f), request({ time: "21:30", partySize: 1 }), "10.0.0.4");
    await withAdminClient((c) =>
      c.query(
        "UPDATE reservation_settings SET public_enabled = false WHERE establishment_id = (SELECT establishment_id FROM reservations WHERE public_code = $1)",
        [next.code],
      ),
    );
    expect(await cancelPublicReservation(f.orgSlug, f.estSlug, next.cancelToken)).toBe("cancelled");
    await withAdminClient((c) =>
      c.query(
        "UPDATE reservation_settings SET public_enabled = true WHERE establishment_id = (SELECT establishment_id FROM reservations WHERE public_code = $1)",
        [next.code],
      ),
    );
  });

  it("un reenvío del formulario renueva el enlace y el anterior deja de valer", async () => {
    const req = request({ time: "20:30", partySize: 1 });
    const first = await bookPublic(await info(other), req, "10.0.0.5");
    const second = await bookPublic(await info(other), req, "10.0.0.5");
    expect(second.replayed).toBe(true);
    expect(second.cancelToken).not.toBe(first.cancelToken);
    expect(await getPublicCancellation(other.orgSlug, other.estSlug, first.cancelToken)).toBeNull();
    expect(await cancelPublicReservation(other.orgSlug, other.estSlug, second.cancelToken)).toBe("cancelled");
  });
});
