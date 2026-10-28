import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { getPublicSite, getSiteProfile, setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

const content = (heroTitle: string) => ({
  theme: "moderno",
  tagline: "",
  heroEyebrow: "",
  heroTitle,
  heroText: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  highlights: [],
  featuredMenuId: null,
});

// Interruptor de publicación de la web, separado del formulario de contenido.
describe("publicar y retirar la web", () => {
  let owner: AuthUser;
  let org: string;
  let orgSlug: string;
  let est: { id: string; slug: string };
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);

  beforeAll(async () => {
    owner = await createTestUser("publish-owner");
    org = await createTestOrganization(owner, "Publicar");
    orgSlug = (await withAdminClient((c) => c.query("SELECT slug FROM organizations WHERE id = $1", [org]))).rows[0]
      .slug;
    const e = await asOwner((tx, ctx) =>
      createEstablishment(tx, ctx, { name: "Muelle", slug: `muelle-${uniqueSuffix()}` }),
    );
    est = { id: e.id, slug: e.slug };
  });

  it("no publica sin un titular guardado", async () => {
    await expect(asOwner((tx, ctx) => setSitePublished(tx, ctx, est.id, { published: true }))).rejects.toThrow(
      ValidationError,
    );
    expect(await getPublicSite(orgSlug, est.slug)).toBeNull();
  });

  it("publica y retira; guardar el contenido conserva el estado", async () => {
    await asOwner((tx, ctx) => updateSiteProfile(tx, ctx, est.id, content("Bienvenidos")));
    expect((await asOwner((tx, ctx) => getSiteProfile(tx, ctx, est.id))).published).toBe(false);

    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est.id, { published: true }));
    expect(await getPublicSite(orgSlug, est.slug)).not.toBeNull();
    // Editar el contenido sin indicar «published» no la despublica.
    await asOwner((tx, ctx) => updateSiteProfile(tx, ctx, est.id, content("Hola de nuevo")));
    expect((await getPublicSite(orgSlug, est.slug))?.heroTitle).toBe("Hola de nuevo");
    // Publicada, no se puede vaciar el titular.
    await expect(asOwner((tx, ctx) => updateSiteProfile(tx, ctx, est.id, content("")))).rejects.toThrow(
      ValidationError,
    );

    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est.id, { published: false }));
    expect(await getPublicSite(orgSlug, est.slug)).toBeNull();

    const actions = (
      await withAdminClient((c) =>
        c.query<{ action: string }>(
          "SELECT action FROM audit_events WHERE organization_id = $1 AND entity_id = $2 AND action LIKE 'site.%published' ORDER BY created_at",
          [org, est.id],
        ),
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(["site.published", "site.unpublished"]);
  });

  it("rechaza valores que no son booleanos", async () => {
    await expect(asOwner((tx, ctx) => setSitePublished(tx, ctx, est.id, { published: "1" }))).rejects.toThrow(
      ValidationError,
    );
  });

  it("el personal no publica y otra organización no ve el local", async () => {
    const staff = await createTestUser("publish-staff");
    await addMember(org, staff, "staff");
    await expect(
      withTenant(staff, org, (tx, ctx) => setSitePublished(tx, ctx, est.id, { published: true })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await createTestUser("publish-other");
    const otherOrg = await createTestOrganization(other, "PublicarAjena");
    await expect(
      withTenant(other, otherOrg, (tx, ctx) => setSitePublished(tx, ctx, est.id, { published: true })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await getPublicSite(orgSlug, est.slug)).toBeNull();
  });
});
