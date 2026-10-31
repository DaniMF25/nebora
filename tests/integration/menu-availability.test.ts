import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, type Establishment } from "@/server/modules/establishments/service";
import {
  addItem,
  addSection,
  createMenu,
  getMenuSummary,
  getPublicMenus,
  publishMenu,
  setMenuAvailability,
  updateMenu,
} from "@/server/modules/menus/menus";
import { createProduct } from "@/server/modules/menus/products";
import { updateSiteProfile } from "@/server/modules/site/service";
import { withTenant } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Cartas con horario (D-036).
describe("horario de las cartas", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: Establishment;
  let breakfast: string;
  let main: string;

  async function publishedMenu(name: string, slug: string): Promise<string> {
    return withTenant(owner, org, async (tx, ctx) => {
      const product = await createProduct(tx, ctx, { name: `Plato ${slug}`, priceCents: 500, allergens: [] });
      const menu = await createMenu(tx, ctx, est.id, { name, slug });
      const section = await addSection(tx, ctx, menu.id, { name: "Platos" });
      await addItem(tx, ctx, menu.id, section, { productId: product.id });
      await publishMenu(tx, ctx, menu.id);
      return menu.id;
    });
  }

  beforeAll(async () => {
    owner = await createTestUser("avail-owner");
    org = await createTestOrganization(owner, "HorarioCartas");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    est = await withTenant(owner, org, (tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Muelle", slug: `muelle-${uniqueSuffix()}` }),
    );
    main = await publishedMenu("Carta", "carta");
    breakfast = await publishedMenu("Desayunos", "desayunos");
  });

  it("guarda las franjas como turnos y null vuelve a «siempre»", async () => {
    await withTenant(owner, org, (tx, ctx) =>
      setMenuAvailability(tx, ctx, breakfast, {
        rules: [{ days: [1, 2, 3, 4, 5, 5], opens: "08:00", closes: "12:00" }],
      }),
    );
    const summary = await withTenant(owner, org, (tx, ctx) => getMenuSummary(tx, ctx, breakfast));
    expect(summary.availability).toHaveLength(5);
    expect(summary.availability![0]).toEqual({ weekday: 1, opensMinute: 480, durationMinutes: 240 });

    await withTenant(owner, org, (tx, ctx) => setMenuAvailability(tx, ctx, main, { rules: null }));
    expect((await withTenant(owner, org, (tx, ctx) => getMenuSummary(tx, ctx, main))).availability).toBeNull();
  });

  it("rechaza franjas solapadas o mal formadas, también en la base de datos", async () => {
    await expect(
      withTenant(owner, org, (tx, ctx) =>
        setMenuAvailability(tx, ctx, main, {
          rules: [
            { days: [1], opens: "08:00", closes: "12:00" },
            { days: [1], opens: "11:00", closes: "13:00" },
          ],
        }),
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      withTenant(owner, org, (tx, ctx) =>
        setMenuAvailability(tx, ctx, main, { rules: [{ days: [8], opens: "08:00", closes: "12:00" }] }),
      ),
    ).rejects.toThrow(ValidationError);
    // Un turno mal formado escrito directamente lo rechaza la restricción.
    for (const bad of [
      '[{"weekday": 8, "opensMinute": 0, "durationMinutes": 60}]',
      '[{"weekday": 1}]',
      "[]",
      '{"a": 1}',
    ]) {
      await expect(
        withAdminClient((c) => c.query("UPDATE menus SET availability = $2::jsonb WHERE id = $1", [main, bad])),
      ).rejects.toThrow(/menus_availability_shape/);
    }
  });

  it("la lectura pública da solo cartas publicadas, con el nombre publicado y la destacada", async () => {
    await withTenant(owner, org, (tx, ctx) => createMenu(tx, ctx, est.id, { name: "Borrador", slug: "borrador" }));
    await withTenant(owner, org, (tx, ctx) => updateMenu(tx, ctx, main, { name: "Nombre sin publicar" }));
    await withTenant(owner, org, (tx, ctx) =>
      updateSiteProfile(tx, ctx, est.id, {
        theme: "moderno",
        tagline: "",
        heroEyebrow: "",
        heroTitle: "Hola",
        heroText: "",
        phone: "",
        whatsapp: "",
        instagram: "",
        highlights: [],
        featuredMenuId: main,
      }),
    );
    const data = await getPublicMenus(orgSlug, est.slug);
    expect(data?.timezone).toBe("Europe/Madrid");
    expect(data?.menus.map((m) => [m.slug, m.name, m.featured])).toEqual([
      ["carta", "Carta", true],
      ["desayunos", "Desayunos", false],
    ]);
    expect(data?.menus[1]!.availability).toHaveLength(5);
    expect(await getPublicMenus(orgSlug, "no-existe")).toBeNull();
  });

  it("el personal no cambia el horario y otra organización no ve la carta", async () => {
    const staff = await createTestUser("avail-staff");
    await addMember(org, staff, "staff");
    await expect(
      withTenant(staff, org, (tx, ctx) => setMenuAvailability(tx, ctx, main, { rules: null })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestUser("avail-other");
    const otherOrg = await createTestOrganization(other, "HorarioAjeno");
    await expect(
      withTenant(other, otherOrg, (tx, ctx) => setMenuAvailability(tx, ctx, main, { rules: null })),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Ni con RLS directamente.
    const rowCount = await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [
          other.id,
          otherOrg,
        ]);
        return (await c.query("UPDATE menus SET availability = NULL WHERE id = $1", [main])).rowCount;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(rowCount).toBe(0);
  });
});
