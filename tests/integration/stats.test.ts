import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import { addItem, addSection, createMenu, publishMenu, unpublishMenu } from "@/server/modules/menus/menus";
import { createProduct } from "@/server/modules/menus/products";
import { updateSiteProfile } from "@/server/modules/site/service";
import { getEstablishmentStats, recordMenuView, recordQrScan, recordSiteView } from "@/server/modules/stats/service";
import { localDateOf } from "@/server/modules/schedules/time";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

interface Fixture {
  owner: AuthUser;
  org: string;
  orgSlug: string;
  est: Establishment;
  menuId: string;
  menuCode: string;
}

async function setupRestaurant(label: string): Promise<Fixture> {
  const owner = await createTestUser(`${label}-owner`);
  const org = await createTestOrganization(owner, label);
  const { rows } = await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]));
  return withTenant(owner, org, async (tx, ctx) => {
    const est = await createEstablishment(tx, ctx, {
      name: `Local ${label}`,
      slug: `local-${uniqueSuffix()}`,
    });
    const product = await createProduct(tx, ctx, {
      name: "Pulpo",
      priceCents: 1650,
    });
    const menu = await createMenu(tx, ctx, est.id, {
      name: "Carta",
      slug: "carta",
      theme: "mediterraneo",
    });
    const section = await addSection(tx, ctx, menu.id, { name: "Del mar" });
    await addItem(tx, ctx, menu.id, section, { productId: product.id });
    return {
      owner,
      org,
      orgSlug: rows[0].slug,
      est,
      menuId: menu.id,
      menuCode: menu.publicCode,
    };
  });
}

const stats = (f: Fixture, period = 7, user = f.owner) =>
  withTenant(user, f.org, (tx, ctx) => getEstablishmentStats(tx, ctx, f.est.id, period));

describe("estadísticas de visitas", () => {
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await setupRestaurant("StatsA");
    b = await setupRestaurant("StatsB");
  });

  it("no cuenta páginas sin publicar ni identificadores inexistentes o mal formados", async () => {
    expect(await recordSiteView(a.orgSlug, a.est.slug)).toBe(false);
    expect(await recordMenuView(a.orgSlug, a.est.slug, "carta")).toBe(false);
    expect(await recordQrScan(a.menuCode)).toBe(false);
    expect(await recordMenuView(a.orgSlug, a.est.slug, "no-existe")).toBe(false);
    expect(await recordQrScan("000000000000")).toBe(false);
    expect(await recordSiteView("x'; DROP TABLE page_view_daily; --", a.est.slug)).toBe(false);
    expect(await recordQrScan("ZZZ")).toBe(false);
    const s = await stats(a);
    expect(s.totals).toEqual({ site: 0, menu: 0, qr: 0 });
  });

  it("cuenta visitas a la web, a la carta y escaneos de QR publicados en el día local", async () => {
    await withTenant(a.owner, a.org, async (tx, ctx) => {
      await publishMenu(tx, ctx, a.menuId);
      await updateSiteProfile(tx, ctx, a.est.id, {
        theme: "mediterraneo",
        tagline: "",
        heroEyebrow: "",
        heroTitle: "Bienvenidos",
        heroText: "",
        phone: "",
        whatsapp: "",
        instagram: "",
        highlights: [],
        featuredMenuId: a.menuId,
        published: true,
      });
    });
    expect(await recordSiteView(a.orgSlug.toUpperCase(), a.est.slug)).toBe(true);
    expect(await recordSiteView(a.orgSlug, a.est.slug)).toBe(true);
    expect(await recordMenuView(a.orgSlug, a.est.slug, "carta")).toBe(true);
    expect(await recordQrScan(a.menuCode)).toBe(true);
    expect(await recordMenuView(a.orgSlug, a.est.slug, "carta")).toBe(true);

    const s = await stats(a);
    expect(s.totals).toEqual({ site: 2, menu: 2, qr: 1 });
    expect(s.days).toHaveLength(7);
    expect(s.to).toBe(localDateOf(new Date(), a.est.timezone));
    expect(s.days.at(-1)).toEqual({ date: s.to, site: 2, menu: 2, qr: 1 });
    expect(s.menus).toEqual([{ menuId: a.menuId, name: "Carta", published: true, views: 2, qr: 1 }]);
    // Un único registro por día y tipo: se acumula, no se guarda cada visita.
    const { rows } = await withAdminClient((c) =>
      c.query("SELECT kind, views FROM page_view_daily WHERE establishment_id = $1 ORDER BY kind", [a.est.id]),
    );
    expect(rows).toEqual([
      { kind: "menu", views: 2 },
      { kind: "qr", views: 1 },
      { kind: "site", views: 2 },
    ]);
  });

  it("al despublicar deja de contar, pero conserva lo acumulado", async () => {
    await withTenant(a.owner, a.org, (tx, ctx) => unpublishMenu(tx, ctx, a.menuId));
    expect(await recordMenuView(a.orgSlug, a.est.slug, "carta")).toBe(false);
    expect(await recordQrScan(a.menuCode)).toBe(false);
    const s = await stats(a);
    expect(s.totals).toEqual({ site: 2, menu: 2, qr: 1 });
    expect(s.menus[0]).toMatchObject({ published: false, views: 2 });
  });

  it("solo incluye el periodo pedido y rechaza periodos no previstos", async () => {
    const old = new Date(Date.now() - 10 * 86400_000);
    await withAdminClient((c) =>
      c.query(
        `INSERT INTO page_view_daily (organization_id, establishment_id, menu_id, kind, day, views)
         VALUES ($1, $2, NULL, 'site', $3::date, 40)`,
        [a.org, a.est.id, localDateOf(old, a.est.timezone)],
      ),
    );
    expect((await stats(a, 7)).totals.site).toBe(2);
    expect((await stats(a, 30)).totals.site).toBe(42);
    await expect(stats(a, 365)).rejects.toBeInstanceOf(ValidationError);
  });

  it("resume las reservas del periodo por estado", async () => {
    const insert = (startsAt: Date, status: string, size: number) =>
      withAdminClient((c) =>
        c.query(
          `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status, customer_name)
           VALUES ($1, $2, $3, $3::timestamptz + interval '90 minutes', $4, $5, 'Cliente')`,
          [a.org, a.est.id, startsAt, size, status],
        ),
      );
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    await insert(twoDaysAgo, "confirmed", 4);
    await insert(twoDaysAgo, "completed", 2);
    await insert(twoDaysAgo, "cancelled", 6);
    await insert(twoDaysAgo, "no_show", 3);
    // Fuera del periodo de 7 días.
    await insert(new Date(Date.now() - 20 * 86400_000), "completed", 8);
    expect((await stats(a, 7)).reservations).toEqual({
      total: 2,
      online: 0,
      covers: 6,
      cancelled: 1,
      noShow: 1,
    });
    expect((await stats(a, 30)).reservations).toMatchObject({
      total: 3,
      covers: 14,
    });
  });

  it("otra organización no ve ni toca las estadísticas", async () => {
    await expect(
      withTenant(b.owner, a.org, (tx, ctx) => getEstablishmentStats(tx, ctx, a.est.id, 7)),
    ).rejects.toThrow();
    await expect(
      withTenant(b.owner, b.org, (tx, ctx) => getEstablishmentStats(tx, ctx, a.est.id, 7)),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await stats(b)).totals).toEqual({ site: 0, menu: 0, qr: 0 });
    // RLS: el rol de la aplicación con el contexto de B no lee filas de A.
    const leaked = await withTenant(b.owner, b.org, (tx) =>
      tx.query("SELECT count(*)::int AS n FROM page_view_daily WHERE establishment_id = $1", [a.est.id]),
    );
    expect(leaked.rows[0].n).toBe(0);
  });

  it("la aplicación no puede escribir contadores directamente", async () => {
    await expect(
      withTenant(a.owner, a.org, (tx) =>
        tx.query("UPDATE page_view_daily SET views = 999999 WHERE establishment_id = $1", [a.est.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(a.owner, a.org, (tx) =>
        tx.query(
          "INSERT INTO page_view_daily (organization_id, establishment_id, kind, day, views) VALUES ($1, $2, 'site', current_date, 5)",
          [a.org, a.est.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("el personal no ve estadísticas; el encargado sí", async () => {
    const staff = await createTestUser("stats-staff");
    const manager = await createTestUser("stats-manager");
    await addMember(a.org, staff, "staff");
    await addMember(a.org, manager, "manager");
    await expect(stats(a, 7, staff)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await stats(a, 7, manager)).totals.site).toBe(2);
  });
});
