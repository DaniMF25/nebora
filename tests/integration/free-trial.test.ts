import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createInvitation } from "@/server/modules/members/service";
import { changePlan, createOrganization, getOrganization } from "@/server/modules/organizations/service";
import { getPublicBookingInfo } from "@/server/modules/public-booking/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { resetTrialExpiryThrottle } from "@/server/modules/organizations/trial";
import { withTenant, withUser } from "@/server/tenancy/context";
import { TRIAL_DAYS } from "@/lib/plans";
import { withAdminClient, withAppClient } from "../support/db";
import { createTestUser, uniqueSuffix } from "../support/factories";

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

const newOrg = (user: AuthUser, label: string) =>
  withUser(user, (tx, ctx) => createOrganization(tx, ctx, { name: `Prueba ${label}`, slug: `${label}-${uniqueSuffix()}` }));

/** Simula que la prueba ya ha terminado. */
const endTrial = (org: string) =>
  withAdminClient((c) => c.query("UPDATE organizations SET trial_ends_at = now() - interval '1 minute' WHERE id = $1", [org]));

// Prueba gratuita de 7 días del plan PRO (D-062).
describe("prueba gratuita", () => {
  it("la primera organización empieza con 7 días del PRO", async () => {
    const owner = await createTestUser("trial-start");
    const org = await newOrg(owner, "trial");
    await withTenant(owner, org, async (tx, ctx) => {
      expect(ctx.plan).toBe("pro");
      expect(ctx.permissions.has("inventory.manage")).toBe(true);
      const { trialEndsAt } = await getOrganization(tx, ctx);
      const days = (trialEndsAt!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(TRIAL_DAYS - 0.01);
      expect(days).toBeLessThanOrEqual(TRIAL_DAYS);
    });
  });

  it("una prueba por persona: la segunda organización empieza en Básico", async () => {
    const owner = await createTestUser("trial-once");
    await newOrg(owner, "first");
    const second = await newOrg(owner, "second");
    await withTenant(owner, second, async (tx, ctx) => {
      expect(ctx.plan).toBe("basic");
      expect((await getOrganization(tx, ctx)).trialEndsAt).toBeNull();
    });
    // Ni dos altas a la vez dan dos pruebas.
    const other = await createTestUser("trial-race");
    const orgs = await Promise.all([newOrg(other, "race-a"), newOrg(other, "race-b")]);
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM organizations WHERE id = ANY($1) AND trial_ends_at IS NOT NULL", [orgs]),
    );
    expect(rows[0].n).toBe(1);
  });

  it("al terminar pasa al Básico: sin reserva online ni invitaciones abiertas", async () => {
    const owner = await createTestUser("trial-end");
    const org = await newOrg(owner, "ending");
    const estSlug = `local-${uniqueSuffix()}`;
    const est = await withTenant(owner, org, async (tx, ctx) => {
      const e = await createEstablishment(tx, ctx, { name: "Local", slug: estSlug });
      await updateReservationSettings(tx, ctx, e.id, BOOKING);
      await createInvitation(tx, ctx, { email: `inv-${uniqueSuffix()}@example.test`, role: "staff" });
      return e.id;
    });
    const orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    await endTrial(org);

    // Las páginas públicas también lo ven (tras la comprobación periódica).
    resetTrialExpiryThrottle();
    expect(await getPublicBookingInfo(orgSlug, estSlug)).toBeNull();

    await withTenant(owner, org, async (tx, ctx) => {
      expect(ctx.plan).toBe("basic");
      expect(ctx.permissions.has("inventory.manage")).toBe(false);
      expect((await getOrganization(tx, ctx)).trialEndsAt).toBeNull();
    });
    const { rows } = await withAdminClient((c) =>
      c.query(
        `SELECT (SELECT public_enabled FROM reservation_settings WHERE establishment_id = $2) AS booking,
                (SELECT count(*)::int FROM invitations WHERE organization_id = $1 AND revoked_at IS NULL) AS open`,
        [org, est],
      ),
    );
    expect(rows[0]).toEqual({ booking: false, open: 0 });
  });

  it("el panel nunca da el PRO después de la fecha, aunque no haya pasado la comprobación periódica", async () => {
    const owner = await createTestUser("trial-panel");
    const org = await newOrg(owner, "panel");
    await endTrial(org);
    await withTenant(owner, org, async (_tx, ctx) => expect(ctx.plan).toBe("basic"));
  });

  it("elegir un plan termina la prueba, incluso el mismo PRO", async () => {
    const owner = await createTestUser("trial-choose");
    const org = await newOrg(owner, "choose");
    await withTenant(owner, org, (tx, ctx) => changePlan(tx, ctx, { plan: "pro" }));
    // Sin prueba en curso, la caducidad ya no la baja de plan.
    await withAdminClient((c) => c.query("SELECT app.expire_trials()"));
    await withTenant(owner, org, async (tx, ctx) => {
      expect(ctx.plan).toBe("pro");
      expect((await getOrganization(tx, ctx)).trialEndsAt).toBeNull();
    });
  });

  it("la aplicación no puede empezar pruebas por su cuenta ni darse días", async () => {
    const owner = await createTestUser("trial-guard");
    const intruder = await createTestUser("trial-intruder");
    const org = await newOrg(owner, "guard");
    // Otra persona no puede empezar una prueba en una organización ajena.
    const { rows } = await withAppClient(async (c) => {
      await c.query("SELECT set_config('app.user_id', $1, false)", [intruder.id]);
      return c.query("SELECT app.start_trial($1, 7) AS started", [org]);
    });
    expect(rows[0].started).toBe(false);
    // Ni marcar de nuevo la prueba como no usada.
    await withAppClient(async (c) => {
      await expect(c.query("UPDATE users SET trial_used_at = NULL WHERE id = $1", [owner.id])).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
