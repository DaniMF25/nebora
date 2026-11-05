import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/server/auth/service";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createEstablishment } from "@/server/modules/establishments/service";
import { getPublicMedia } from "@/server/modules/media/service";
import { changePlan } from "@/server/modules/organizations/service";
import { addGalleryImage } from "@/server/modules/site/gallery";
import { setSitePublished, updateSiteProfile } from "@/server/modules/site/service";
import {
  createStory,
  deleteStory,
  getPublicStories,
  listStories,
  MAX_STORIES,
  moveStory,
  removeStoryImage,
  updateStory,
} from "@/server/modules/site/stories";
import { localDateOf, addDays } from "@/server/modules/schedules/time";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { withAdminClient, withAppClient } from "../support/db";
import { addMember, createTestOrganization, createTestUser, uniqueSuffix } from "../support/factories";

async function png(color = "#336699"): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 40, height: 60, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

const profile = {
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
const story = (over: Record<string, unknown> = {}) => ({
  title: "Inauguramos terraza",
  body: "Desde el viernes, cenas al aire libre.",
  ctaKind: "booking",
  ctaLabel: "",
  ctaUrl: "",
  startsOn: "",
  endsOn: "",
  ...over,
});

// Historias de la web (D-059).
describe("historias de la web", () => {
  let owner: AuthUser;
  let waiter: AuthUser;
  let org: string;
  let est: string;
  const asOwner = <T>(fn: (tx: Tx, ctx: TenantContext) => Promise<T>) => withTenant(owner, org, fn);
  const titles = async () => (await asOwner((tx, ctx) => listStories(tx, ctx, est))).map((s) => s.title);
  const today = localDateOf(new Date(), "Europe/Madrid");

  beforeAll(async () => {
    owner = await createTestUser("story-owner");
    waiter = await createTestUser("story-waiter");
    org = await createTestOrganization(owner, "historias", "advanced");
    await addMember(org, waiter, "staff");
    est = await asOwner(async (tx, ctx) => {
      const id = (await createEstablishment(tx, ctx, { name: "Puerto", slug: `puerto-${uniqueSuffix()}` })).id;
      await updateSiteProfile(tx, ctx, id, profile);
      await setSitePublished(tx, ctx, id, { published: true });
      return id;
    });
  });

  it("crea, ordena, modifica y borra; la web muestra solo las vigentes y en orden", async () => {
    const terraza = await asOwner(async (tx, ctx) => createStory(tx, ctx, est, story(), await png()));
    const horario = await asOwner((tx, ctx) =>
      createStory(tx, ctx, est, story({ title: "Nuevo horario", ctaKind: "none", startsOn: today, endsOn: today })),
    );
    const futura = await asOwner((tx, ctx) =>
      createStory(tx, ctx, est, story({ title: "Navidad", startsOn: addDays(today, 30) })),
    );
    const pasada = await asOwner((tx, ctx) =>
      createStory(tx, ctx, est, story({ title: "Verano", endsOn: addDays(today, -1) })),
    );
    expect(await titles()).toEqual(["Inauguramos terraza", "Nuevo horario", "Navidad", "Verano"]);
    let pub = await getPublicStories(est);
    expect(pub.map((s) => s.title)).toEqual(["Inauguramos terraza", "Nuevo horario"]);
    expect(pub[0]).toMatchObject({ ctaKind: "booking", ctaLabel: null, ctaUrl: null });
    expect(pub[0]!.mediaId).toBeTruthy();

    // El orden decide cuál se abre sola: la primera.
    await asOwner((tx, ctx) => moveStory(tx, ctx, est, horario, "up"));
    expect((await getPublicStories(est)).map((s) => s.title)).toEqual(["Nuevo horario", "Inauguramos terraza"]);

    // Editar cambia la versión (vuelve a contar como no vista) y puede cambiar el botón a un enlace propio.
    const before = (await getPublicStories(est)).find((s) => s.id === terraza)!.version;
    await new Promise((ok) => setTimeout(ok, 5));
    await asOwner((tx, ctx) =>
      updateStory(
        tx,
        ctx,
        est,
        terraza,
        story({ ctaKind: "url", ctaLabel: "Ver evento", ctaUrl: "https://example.test/evento" }),
      ),
    );
    pub = await getPublicStories(est);
    const edited = pub.find((s) => s.id === terraza)!;
    expect(edited).toMatchObject({ ctaKind: "url", ctaLabel: "Ver evento", ctaUrl: "https://example.test/evento" });
    expect(edited.version).not.toBe(before);
    expect(edited.mediaId).toBeTruthy(); // sin foto nueva se conserva la anterior

    for (const id of [futura, pasada]) await asOwner((tx, ctx) => deleteStory(tx, ctx, est, id));
    expect(await titles()).toEqual(["Nuevo horario", "Inauguramos terraza"]);
  });

  it("la foto se sirve solo mientras la historia está vigente; cambiarla o quitarla borra el archivo", async () => {
    const id = await asOwner(async (tx, ctx) =>
      createStory(tx, ctx, est, story({ title: "Con foto", ctaKind: "none" }), await png("#aa3311")),
    );
    const first = (await asOwner((tx, ctx) => listStories(tx, ctx, est))).find((s) => s.id === id)!.mediaId!;
    expect(await getPublicMedia(first)).not.toBeNull();
    await asOwner(async (tx, ctx) =>
      updateStory(tx, ctx, est, id, story({ title: "Con foto", ctaKind: "none" }), await png("#11aa33")),
    );
    const second = (await asOwner((tx, ctx) => listStories(tx, ctx, est))).find((s) => s.id === id)!.mediaId!;
    expect(second).not.toBe(first);
    const exists = async (mediaId: string) =>
      (await withAdminClient((c) => c.query("SELECT 1 FROM media_assets WHERE id = $1", [mediaId]))).rowCount;
    expect(await exists(first)).toBe(0);
    // Caducada: la foto deja de ser pública aunque se conozca su enlace.
    await asOwner((tx, ctx) =>
      updateStory(tx, ctx, est, id, story({ title: "Con foto", ctaKind: "none", endsOn: addDays(today, -1) })),
    );
    expect(await getPublicMedia(second)).toBeNull();
    await asOwner((tx, ctx) => removeStoryImage(tx, ctx, est, id));
    expect(await exists(second)).toBe(0);
    expect((await asOwner((tx, ctx) => listStories(tx, ctx, est))).find((s) => s.id === id)!.mediaId).toBeNull();
    await asOwner((tx, ctx) => deleteStory(tx, ctx, est, id));
  });

  it("valida titular, texto, enlace (solo https), fechas y el máximo", async () => {
    const rejects = (over: Record<string, unknown>) =>
      expect(asOwner((tx, ctx) => createStory(tx, ctx, est, story(over)))).rejects.toThrow(ValidationError);
    await rejects({ title: "  " });
    await rejects({ title: "x".repeat(61) });
    await rejects({ body: "x".repeat(281) });
    await rejects({ ctaKind: "url", ctaLabel: "Ir", ctaUrl: "javascript:alert(1)" });
    await rejects({ ctaKind: "url", ctaLabel: "Ir", ctaUrl: "http://example.test" });
    await rejects({ ctaKind: "url", ctaLabel: "", ctaUrl: "https://example.test" });
    await rejects({ ctaKind: "llamar" });
    await rejects({ startsOn: "2030-02-30" });
    await rejects({ startsOn: "2030-05-10", endsOn: "2030-05-01" });
    await rejects({ organizationId: org });
    // Un enlace en otro tipo de botón se descarta.
    const id = await asOwner((tx, ctx) =>
      createStory(tx, ctx, est, story({ ctaKind: "menu", ctaLabel: "x", ctaUrl: "https://example.test" })),
    );
    expect((await asOwner((tx, ctx) => listStories(tx, ctx, est))).find((s) => s.id === id)).toMatchObject({
      ctaLabel: null,
      ctaUrl: null,
    });
    // La BD también impide un enlace que no sea https.
    await expect(
      withAdminClient((c) => c.query("UPDATE site_stories SET cta_kind = 'url', cta_label = 'x', cta_url = 'javascript:x' WHERE id = $1", [id])),
    ).rejects.toMatchObject({ code: "23514" });
    const existing = (await asOwner((tx, ctx) => listStories(tx, ctx, est))).length;
    for (let n = existing; n < MAX_STORIES; n++) {
      await asOwner((tx, ctx) => createStory(tx, ctx, est, story({ title: `Relleno ${n}` })));
    }
    await rejects({});
    const all = await asOwner((tx, ctx) => listStories(tx, ctx, est));
    for (const s of all.slice(2)) await asOwner((tx, ctx) => deleteStory(tx, ctx, est, s.id));
  });

  it("permisos, aislamiento y RLS: el personal no edita; otra organización no ve ni toca", async () => {
    const [first] = await asOwner((tx, ctx) => listStories(tx, ctx, est));
    await withTenant(waiter, org, async (tx, ctx) => {
      expect((await listStories(tx, ctx, est)).length).toBeGreaterThan(0);
      await expect(createStory(tx, ctx, est, story())).rejects.toThrow(ForbiddenError);
      await expect(deleteStory(tx, ctx, est, first!.id)).rejects.toThrow(ForbiddenError);
    });
    const outsider = await createTestUser("story-out");
    const other = await createTestOrganization(outsider, "ajena", "advanced");
    await withTenant(outsider, other, async (tx, ctx) => {
      await expect(listStories(tx, ctx, est)).rejects.toThrow(NotFoundError);
      await expect(createStory(tx, ctx, est, story())).rejects.toThrow(NotFoundError);
    });
    await withAppClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("SELECT set_config('app.user_id', $1, true)", [outsider.id]);
        await c.query("SELECT set_config('app.org_id', $1, true)", [other]);
        expect((await c.query("SELECT count(*)::int AS n FROM site_stories")).rows[0].n).toBe(0);
        await expect(
          c.query("INSERT INTO site_stories (organization_id, establishment_id, title, position) VALUES ($1, $2, 'x', 99)", [
            org,
            est,
          ]),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await c.query("ROLLBACK");
      }
    });
  });

  it("sin publicar o en Básico no hay historias públicas ni se pueden crear; la galería tampoco sirve fotos en Básico", async () => {
    const [first] = await asOwner((tx, ctx) => listStories(tx, ctx, est));
    const storyMedia = (await asOwner((tx, ctx) => listStories(tx, ctx, est))).find((s) => s.mediaId)?.mediaId;
    const galleryImage = await asOwner(async (tx, ctx) => addGalleryImage(tx, ctx, est, await png("#222222"), {}));
    const galleryMedia = (
      await withAdminClient((c) => c.query("SELECT media_id FROM site_gallery_images WHERE id = $1", [galleryImage]))
    ).rows[0].media_id as string;
    expect(await getPublicMedia(galleryMedia)).not.toBeNull();

    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est, { published: false }));
    expect(await getPublicStories(est)).toEqual([]);
    await asOwner((tx, ctx) => setSitePublished(tx, ctx, est, { published: true }));

    await withAdminClient((c) =>
      c.query("DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2", [org, waiter.id]),
    );
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "basic" }));
    expect(await getPublicStories(est)).toEqual([]);
    if (storyMedia) expect(await getPublicMedia(storyMedia)).toBeNull();
    expect(await getPublicMedia(galleryMedia)).toBeNull();
    await expect(asOwner((tx, ctx) => createStory(tx, ctx, est, story()))).rejects.toThrow(ForbiddenError);
    // Lo guardado se conserva y vuelve al subir de plan.
    expect((await asOwner((tx, ctx) => listStories(tx, ctx, est))).map((s) => s.id)).toContain(first!.id);
    await asOwner((tx, ctx) => changePlan(tx, ctx, { plan: "advanced" }));
    expect((await getPublicStories(est)).length).toBeGreaterThan(0);
  });
});
