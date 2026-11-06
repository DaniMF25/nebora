import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError } from "@/server/errors";
import { submitContactMessage } from "@/server/modules/contact/service";
import { createEstablishment } from "@/server/modules/establishments/service";
import { createTable, createZone } from "@/server/modules/floor/service";
import { createIngredient, createWarehouse, recordMovement, updateIngredient } from "@/server/modules/inventory/service";
import { applyCount, openCount, saveCountLines } from "@/server/modules/inventory/operations";
import { createInvitation } from "@/server/modules/members/service";
import { addItem, addSection, createMenu, publishMenu } from "@/server/modules/menus/menus";
import { createProduct } from "@/server/modules/menus/products";
import { changePlan, createOrganization, getOrganization } from "@/server/modules/organizations/service";
import { resetTrialExpiryThrottle } from "@/server/modules/organizations/trial";
import { createOrder, createSupplier, setOrderLine } from "@/server/modules/purchasing/service";
import { setRecipeLine } from "@/server/modules/recipes/service";
import { createReservation } from "@/server/modules/reservations/service";
import { setWeeklyHours } from "@/server/modules/schedules/service";
import { getPublicSite, setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import { createStory } from "@/server/modules/site/stories";
import { createShift, createStaffMember } from "@/server/modules/staff/service";
import { withTenant, withUser } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const newOrg = (user: AuthUser, label: string, slug = `${label}-${uniqueSuffix()}`) =>
  withUser(user, (tx, ctx) => createOrganization(tx, ctx, { name: `Prueba ${label}`, slug }));
const endTrial = (org: string) =>
  withAdminClient((c) => c.query("UPDATE organizations SET trial_ends_at = now() - interval '1 minute' WHERE id = $1", [org]));
const lockedDaysAgo = (org: string, days: number) =>
  withAdminClient((c) =>
    c.query("UPDATE organizations SET locked_at = now() - make_interval(days => $2) WHERE id = $1", [org, days]),
  );
const site = {
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
};

/** Organización con datos en casi todas las tablas, para comprobar que el borrado no deja nada. */
async function fullOrganization(owner: AuthUser, label: string) {
  const orgSlug = `${label}-${uniqueSuffix()}`;
  const org = await newOrg(owner, label, orgSlug);
  const waiter = await createTestUser(`${label}-waiter`);
  await addMember(org, waiter, "staff");
  const estSlug = `local-${uniqueSuffix()}`;
  await withTenant(owner, org, async (tx, ctx) => {
    const est = (await createEstablishment(tx, ctx, { name: "Local", slug: estSlug })).id;
    await setWeeklyHours(tx, ctx, est, {
      slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opens: "12:00", closes: "23:00" })),
    });
    const zone = await createZone(tx, ctx, est, { name: "Sala" });
    const table = (await createTable(tx, ctx, zone, { name: "M1", maxCapacity: 4 })).id;
    await createReservation(tx, ctx, est, {
      date: "2030-05-10",
      time: "14:00",
      durationMinutes: 60,
      partySize: 2,
      customerName: "Cliente",
      customerPhone: "+34 600 000 000",
      tableIds: [table],
    });
    const product = await createProduct(tx, ctx, { name: "Croquetas", priceCents: 900, allergens: [] });
    const menu = await createMenu(tx, ctx, est, { name: "Carta", slug: "carta", theme: "clasico" });
    const section = await addSection(tx, ctx, menu.id, { name: "Entrantes" });
    await addItem(tx, ctx, menu.id, section, { productId: product.id });
    await publishMenu(tx, ctx, menu.id);
    const flour = (await createIngredient(tx, ctx, { name: "Harina", baseUnit: "g" })).id;
    await updateIngredient(tx, ctx, flour, { cost: "1,00" });
    await setRecipeLine(tx, ctx, product.id, { ingredientId: flour, quantity: "50", unit: "g" });
    const wh = await createWarehouse(tx, ctx, est, { name: "Despensa" });
    await recordMovement(tx, ctx, { warehouseId: wh, ingredientId: flour, kind: "receipt", quantity: "2", unit: "kg", idempotencyKey: randomUUID() });
    // Recuento aplicado: sus líneas quedan protegidas frente a la aplicación.
    const count = await openCount(tx, ctx, { warehouseId: wh });
    await saveCountLines(tx, ctx, count, { lines: [{ ingredientId: flour, quantity: "1,5", unit: "kg" }] });
    await applyCount(tx, ctx, count);
    const supplier = await createSupplier(tx, ctx, { name: "Molinos" });
    const order = await createOrder(tx, ctx, { supplierId: supplier.id, warehouseId: wh });
    await setOrderLine(tx, ctx, order, { ingredientId: flour, quantity: "5", unit: "kg", unitPrice: "1,00" });
    const person = await createStaffMember(tx, ctx, { name: "Ana", position: "Sala", userId: "" });
    await createShift(tx, ctx, est, { staffMemberId: person.id, date: "2030-05-10", start: "12:00", end: "16:00", position: "", notes: "" });
    await updateSiteProfile(tx, ctx, est, site);
    await setSitePublished(tx, ctx, est, { published: true });
    const photo = new Uint8Array(await sharp({ create: { width: 40, height: 60, channels: 3, background: "#aa3311" } }).png().toBuffer());
    await createStory(tx, ctx, est, { title: "Terraza", body: "", ctaKind: "none", ctaLabel: "", ctaUrl: "", startsOn: "", endsOn: "" }, photo);
    await createInvitation(tx, ctx, { email: `inv-${uniqueSuffix()}@example.test`, role: "staff" });
    return est;
  }).then((est) =>
    submitContactMessage(
      est,
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
      `10.7.${Math.floor(Math.random() * 200)}.1`,
    ),
  );
  return { org, orgSlug, estSlug, waiter };
}

/** Filas de una organización en cada tabla que tiene organization_id (solo las que tienen alguna). */
async function rowsOf(org: string): Promise<Record<string, number>> {
  return withAdminClient(async (c) => {
    const { rows: tables } = await c.query<{ t: string }>(
      `SELECT format('%I', c.table_name) AS t FROM information_schema.columns c
         JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE'`,
    );
    const out: Record<string, number> = {};
    for (const { t } of tables) {
      const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [org]);
      if (rows[0]!.n > 0) out[t] = rows[0]!.n;
    }
    const o = await c.query("SELECT 1 FROM organizations WHERE id = $1", [org]);
    if (o.rowCount) out.organizations = 1;
    return out;
  });
}

// Fin de la prueba: bloqueo, 15 días de web y borrado (D-068).
describe("organizaciones sin plan", () => {
  it("al terminar la prueba el panel se bloquea: solo ver la organización; la web sigue", async () => {
    const owner = await createTestUser("lock-owner");
    const { org, orgSlug, estSlug, waiter } = await fullOrganization(owner, "lock");
    await endTrial(org);
    await withTenant(owner, org, async (tx, ctx) => {
      expect(ctx.lockedAt).toBeInstanceOf(Date);
      expect([...ctx.permissions]).toEqual(["organization.read"]);
      expect((await getOrganization(tx, ctx)).lockedAt).toBeInstanceOf(Date);
      await expect(createEstablishment(tx, ctx, { name: "Otro", slug: `otro-${uniqueSuffix()}` })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
    await withTenant(waiter, org, async (_tx, ctx) => expect([...ctx.permissions]).toEqual(["organization.read"]));
    // La web y la carta siguen visibles durante el plazo.
    resetTrialExpiryThrottle();
    expect(await getPublicSite(orgSlug, estSlug)).not.toBeNull();
    // Solo el propietario elige plan; al hacerlo se desbloquea con todo lo que tenía.
    await expect(withTenant(waiter, org, (tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Con más miembros, el Básico (una sola persona) no vale: el mensaje lo explica sin pedir quitar a nadie.
    await expect(withTenant(owner, org, (tx, ctx) => changePlan(tx, ctx, { plan: "basic" }))).rejects.toThrow(
      /elige el Avanzado o el PRO/,
    );
    await withTenant(owner, org, (tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }));
    await withTenant(owner, org, async (_tx, ctx) => {
      expect(ctx.lockedAt).toBeNull();
      expect(ctx.permissions.has("menus.edit")).toBe(true);
    });
  });

  it("sin prueba (la persona ya usó la suya), la organización nace bloqueada", async () => {
    const owner = await createTestUser("lock-second");
    await newOrg(owner, "first");
    const second = await newOrg(owner, "second");
    await withTenant(owner, second, async (_tx, ctx) => expect(ctx.lockedAt).toBeInstanceOf(Date));
  });

  it("a los 15 días sin plan se borra por completo; antes, no", async () => {
    const owner = await createTestUser("purge-owner");
    const { org, orgSlug, estSlug, waiter } = await fullOrganization(owner, "purge");
    const other = await createTestOrganization(owner, "keep");
    const before = await rowsOf(org);
    // La prueba cubre de verdad las tablas importantes.
    for (const t of ["establishments", "menus", "reservations", "stock_count_lines", "media_assets", "contact_messages", "audit_events", "memberships"]) {
      expect(before[t], t).toBeGreaterThan(0);
    }

    await endTrial(org);
    await withAdminClient((c) => c.query("SELECT app.expire_trials()"));
    await lockedDaysAgo(org, 14);
    await withAppClient((c) => c.query("SELECT app.purge_locked_organizations()"));
    expect(await rowsOf(org)).toMatchObject({ organizations: 1 });

    await lockedDaysAgo(org, 16);
    resetTrialExpiryThrottle();
    // La siguiente visita a la web lo aplica: ya no hay web ni organización.
    expect(await getPublicSite(orgSlug, estSlug)).toBeNull();
    expect(await rowsOf(org)).toEqual({});
    const tomb = await withAdminClient((c) => c.query("SELECT purged_at FROM purged_organizations WHERE id = $1", [org]));
    expect(tomb.rowCount).toBe(1);
    // Las cuentas de las personas y las demás organizaciones siguen.
    const users = await withAdminClient((c) =>
      c.query("SELECT count(*)::int AS n FROM users WHERE id = ANY($1)", [[owner.id, waiter.id]]),
    );
    expect(users.rows[0].n).toBe(2);
    expect(Object.keys(await rowsOf(other))).toContain("organizations");
  });

  it("la aplicación no puede fechar un bloqueo en el pasado ni borrar organizaciones por su cuenta", async () => {
    const owner = await createTestUser("lock-guard");
    const org = await createTestOrganization(owner, "guard");
    await withAppClient(async (c) => {
      // Con el contexto del propietario (RLS deja ver y cambiar su organización).
      await c.query("SELECT set_config('app.user_id', $1, false), set_config('app.org_id', $2, false)", [owner.id, org]);
      await expect(
        c.query("UPDATE organizations SET locked_at = now() - interval '30 days' WHERE id = $1", [org]),
      ).rejects.toThrow(/bloqueo con fecha no permitida/);
      // Bloquear con la hora actual y desbloquear sí puede (alta sin prueba y elegir plan).
      expect((await c.query("UPDATE organizations SET locked_at = now() WHERE id = $1", [org])).rowCount).toBe(1);
      expect((await c.query("UPDATE organizations SET locked_at = NULL WHERE id = $1", [org])).rowCount).toBe(1);
      await expect(c.query("SELECT app.purge_organization($1)", [org])).rejects.toThrow(/permission denied/);
    });
  });
});
