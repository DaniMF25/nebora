import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment, setEstablishmentLanguages } from "@/server/modules/establishments/service";
import {
  addItem,
  addSection,
  createMenu,
  getPublishedMenu,
  hasUnpublishedChanges,
  publishMenu,
} from "@/server/modules/menus/menus";
import { createProduct, updateProduct } from "@/server/modules/menus/products";
import { listMembers, setMemberEstablishments } from "@/server/modules/members/service";
import { getPublicSite, localizePublicSite, updateSiteProfile } from "@/server/modules/site/service";
import {
  getMenuTranslationForm,
  getSiteTranslationForm,
  saveMenuTranslations,
  saveSiteTranslations,
} from "@/server/modules/translations/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

// Traducciones manuales de cartas y web (D-033).
describe("traducciones", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: { id: string; slug: string };
  let menuId: string;
  let sectionId: string;
  let productId: string;

  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("tr-owner");
    org = await createTestOrganization(owner, "Traducciones");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    await asOwner(async (tx, ctx) => {
      const e = await createEstablishment(tx, ctx, { name: "Puerto", slug: `puerto-${uniqueSuffix()}` });
      est = { id: e.id, slug: e.slug };
      productId = (
        await createProduct(tx, ctx, { name: "Croquetas", description: "De jamón ibérico", priceCents: 900 })
      ).id;
      menuId = (await createMenu(tx, ctx, est.id, { name: "Carta", slug: "carta", theme: "moderno" })).id;
      sectionId = await addSection(tx, ctx, menuId, { name: "Entrantes" });
      await addItem(tx, ctx, menuId, sectionId, { productId });
      await publishMenu(tx, ctx, menuId);
    });
  });

  it("sin idiomas activos no hay formulario ni se puede guardar", async () => {
    expect(await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, "en"))).toBeNull();
    await expect(
      asOwner((tx, ctx) => saveMenuTranslations(tx, ctx, menuId, "en", { menuName: "Menu" })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("activar idiomas: solo los de la lista, sin repetir y en orden fijo", async () => {
    await expect(
      asOwner((tx, ctx) => setEstablishmentLanguages(tx, ctx, est.id, { languages: ["en", "xx"] })),
    ).rejects.toBeInstanceOf(ValidationError);
    await asOwner((tx, ctx) => setEstablishmentLanguages(tx, ctx, est.id, { languages: ["fr", "en", "en"] }));
    const form = await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, undefined));
    expect(form!.languages).toEqual(["en", "fr"]);
    expect(form!.lang).toBe("en");
    expect(form!.summary).toEqual({ done: 0, stale: 0, missing: 3 });
  });

  it("guarda la traducción de carta, categoría y producto; vacío = sin traducir", async () => {
    await asOwner((tx, ctx) =>
      saveMenuTranslations(tx, ctx, menuId, "en", {
        menuName: "Menu",
        sections: { [sectionId]: "Starters" },
        products: { [productId]: { name: "Croquettes", description: "" } },
      }),
    );
    const form = (await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, "en")))!;
    expect(form.menu.value.name).toBe("Menu");
    expect(form.sections[0]).toMatchObject({ value: { name: "Starters" }, status: "done" });
    expect(form.products[0]).toMatchObject({ value: { name: "Croquettes", description: "" }, status: "done" });
    expect(form.summary).toEqual({ done: 3, stale: 0, missing: 0 });
    // Francés sigue sin traducir.
    expect((await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, "fr")))!.summary.missing).toBe(3);
  });

  it("la carta publicada lleva las traducciones al volver a publicar", async () => {
    expect(await asOwner((tx, ctx) => hasUnpublishedChanges(tx, ctx, menuId))).toBe(true);
    await asOwner((tx, ctx) => publishMenu(tx, ctx, menuId));
    const published = (await getPublishedMenu(orgSlug, est.slug, "carta"))!;
    expect(published.snapshot.languages).toEqual(["en", "fr"]);
    expect(published.snapshot.menuNameI18n).toEqual({ en: "Menu" });
    expect(published.snapshot.sections[0]!.i18n).toEqual({ en: { name: "Starters" } });
    expect(published.snapshot.sections[0]!.items[0]!.i18n).toEqual({ en: { name: "Croquettes" } });
  });

  it("si cambia el original, la traducción queda «por revisar»", async () => {
    await asOwner((tx, ctx) => updateProduct(tx, ctx, productId, { description: "De jamón ibérico de bellota" }));
    const form = (await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, "en")))!;
    expect(form.products[0]!.status).toBe("stale");
    expect(form.summary).toEqual({ done: 2, stale: 1, missing: 0 });
    // Volver a guardarla la marca como al día.
    await asOwner((tx, ctx) =>
      saveMenuTranslations(tx, ctx, menuId, "en", {
        menuName: "Menu",
        sections: { [sectionId]: "Starters" },
        products: { [productId]: { name: "Croquettes", description: "Acorn-fed Iberian ham" } },
      }),
    );
    expect((await asOwner((tx, ctx) => getMenuTranslationForm(tx, ctx, menuId, "en")))!.summary.stale).toBe(0);
  });

  it("valida idioma, longitudes, pertenencia y permisos", async () => {
    await expect(
      asOwner((tx, ctx) => saveMenuTranslations(tx, ctx, menuId, "de", { menuName: "Karte" })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      asOwner((tx, ctx) => saveMenuTranslations(tx, ctx, menuId, "en", { menuName: "x".repeat(121) })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      asOwner((tx, ctx) =>
        saveMenuTranslations(tx, ctx, menuId, "en", {
          menuName: "",
          sections: { "00000000-0000-0000-0000-000000000000": "X" },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Un encargado limitado a este local traduce la carta, pero no los productos (catálogo común).
    const mgr = await createTestUser("tr-mgr");
    await addMember(org, mgr, "manager");
    const m = (await asOwner((tx, ctx) => listMembers(tx, ctx))).find((x) => x.userId === mgr.id)!;
    await asOwner((tx, ctx) =>
      setMemberEstablishments(tx, ctx, m.membershipId, { allEstablishments: false, establishmentIds: [est.id] }),
    );
    await withTenant(mgr, org, (tx, ctx) => saveMenuTranslations(tx, ctx, menuId, "fr", { menuName: "Carte" }));
    await expect(
      withTenant(mgr, org, (tx, ctx) =>
        saveMenuTranslations(tx, ctx, menuId, "fr", {
          menuName: "Carte",
          products: { [productId]: { name: "Croquettes", description: "" } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Otra organización no la ve.
    const other = await createTestUser("tr-other");
    const otherOrg = await createTestOrganization(other, "TrAjena");
    await expect(
      withTenant(other, otherOrg, (tx, ctx) => saveMenuTranslations(tx, ctx, menuId, "en", { menuName: "X" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("la base de datos rechaza idiomas o estructuras no válidos", async () => {
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [owner.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [org]);
        for (const bad of ['{"xx": {"name": "A"}}', '{"en": "texto"}', '{"en": {"name": 5}}', "[]"]) {
          await c.query("SAVEPOINT s");
          await expect(c.query("UPDATE menus SET i18n = $2::jsonb WHERE id = $1", [menuId, bad])).rejects.toThrow(
            /menus_i18n_check/,
          );
          await c.query("ROLLBACK TO SAVEPOINT s");
        }
        await expect(
          c.query("UPDATE establishments SET languages = '{en,en}' WHERE id = $1", [est.id]),
        ).rejects.toThrow(/establishments_languages_check/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("web: traduce los textos y los destacados; la web pública los aplica por idioma", async () => {
    await expect(
      asOwner((tx, ctx) => saveSiteTranslations(tx, ctx, est.id, "en", { heroTitle: "Welcome" })),
    ).rejects.toBeInstanceOf(ValidationError); // sin contenido en español todavía
    await asOwner((tx, ctx) =>
      updateSiteProfile(tx, ctx, est.id, {
        theme: "mediterraneo",
        tagline: "Cocina de mar",
        heroEyebrow: "",
        heroTitle: "Bienvenidos",
        heroText: "Producto del día",
        phone: "",
        whatsapp: "",
        instagram: "",
        highlights: [{ icon: "fish", title: "Pescado del día", text: "De la lonja" }],
        featuredMenuId: menuId,
        published: true,
      }),
    );
    await asOwner((tx, ctx) =>
      saveSiteTranslations(tx, ctx, est.id, "en", {
        tagline: "Seafood kitchen",
        heroTitle: "Welcome",
        highlights: [{ title: "Catch of the day", text: "" }],
      }),
    );
    const form = (await asOwner((tx, ctx) => getSiteTranslationForm(tx, ctx, est.id, "en")))!;
    expect(form.status).toBe("done");
    const site = (await getPublicSite(orgSlug, est.slug))!;
    expect(site.languages).toEqual(["en", "fr"]);
    const en = localizePublicSite(site, "en");
    expect(en).toMatchObject({ tagline: "Seafood kitchen", heroTitle: "Welcome", heroText: "Producto del día" });
    expect(en.highlights[0]).toMatchObject({ title: "Catch of the day", text: "De la lonja", icon: "fish" });
    expect(localizePublicSite(site, "fr").heroTitle).toBe("Bienvenidos");
    expect(localizePublicSite(site, "es")).toBe(site);
    // Si el idioma se desactiva, deja de aplicarse (pero no se borra).
    await asOwner((tx, ctx) => setEstablishmentLanguages(tx, ctx, est.id, { languages: ["fr"] }));
    expect(localizePublicSite((await getPublicSite(orgSlug, est.slug))!, "en").heroTitle).toBe("Bienvenidos");
    await asOwner((tx, ctx) => setEstablishmentLanguages(tx, ctx, est.id, { languages: ["en", "fr"] }));
    expect(localizePublicSite((await getPublicSite(orgSlug, est.slug))!, "en").heroTitle).toBe("Welcome");
  });
});
