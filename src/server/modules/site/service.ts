import "server-only";
import { z } from "zod";
import { MENU_THEMES, type MenuTheme } from "@/lib/menu-snapshot";
import { HIGHLIGHT_ICONS, MAX_HIGHLIGHTS, type SiteHighlight } from "@/lib/site";
import { recordAudit } from "@/server/audit/audit";
import { getPool, type Tx } from "@/server/db/pool";
import { ValidationError } from "@/server/errors";
import { storeImage } from "@/server/modules/media/service";
import { getEstablishment } from "@/server/modules/establishments/service";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { parseInput } from "@/server/validation";
import type { Language, PublicLanguage } from "@/lib/languages";

/** Contenido de la página pública del local, tal como lo edita el restaurante. */
export interface SiteProfile {
  establishmentId: string;
  published: boolean;
  theme: MenuTheme;
  tagline: string | null;
  heroEyebrow: string | null;
  heroTitle: string | null;
  heroText: string | null;
  heroMediaId: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  highlights: SiteHighlight[];
  featuredMenuId: string | null;
  updatedAt: Date | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/** Acepta «+34 600 11 22 33»: se guardan solo los dígitos con prefijo internacional. */
const whatsappSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, "").replace(/^\+/, ""))
  .refine((v) => v === "" || /^[0-9]{6,15}$/.test(v), {
    message: "Escribe el número con prefijo internacional, p. ej. +34 600 112 233",
  })
  .transform((v) => (v === "" ? null : v))
  .nullable();

/** Acepta «@usuario» o la URL del perfil; se guarda solo el usuario. */
const instagramSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/+$/, ""))
  .refine((v) => v === "" || /^[A-Za-z0-9._]{1,30}$/.test(v), { message: "Usuario de Instagram no válido" })
  .transform((v) => (v === "" ? null : v))
  .nullable();

const highlightSchema = z
  .object({
    icon: z.enum(HIGHLIGHT_ICONS),
    title: z.string().trim().min(1, "Falta el título").max(40, "Máximo 40 caracteres"),
    text: z.string().trim().max(120, "Máximo 120 caracteres"),
  })
  .strict();

export const updateSiteSchema = z
  .object({
    theme: z.enum(MENU_THEMES),
    tagline: optionalText(60),
    heroEyebrow: optionalText(60),
    heroTitle: optionalText(120),
    heroText: optionalText(400),
    phone: optionalText(40).refine((v) => v === null || /^[0-9+()\s.-]{6,40}$/.test(v), {
      message: "Teléfono no válido",
    }),
    whatsapp: whatsappSchema,
    instagram: instagramSchema,
    highlights: z.array(highlightSchema).max(MAX_HIGHLIGHTS),
    featuredMenuId: z.string().uuid().nullable(),
    published: z.boolean(),
  })
  .strict();

const COLUMNS = `establishment_id AS "establishmentId", published, theme, tagline, hero_eyebrow AS "heroEyebrow",
  hero_title AS "heroTitle", hero_text AS "heroText", hero_media_id AS "heroMediaId", phone, whatsapp, instagram,
  highlights, featured_menu_id AS "featuredMenuId", updated_at AS "updatedAt"`;

function emptyProfile(establishmentId: string): SiteProfile {
  return {
    establishmentId,
    published: false,
    theme: "mediterraneo",
    tagline: null,
    heroEyebrow: null,
    heroTitle: null,
    heroText: null,
    heroMediaId: null,
    phone: null,
    whatsapp: null,
    instagram: null,
    highlights: [],
    featuredMenuId: null,
    updatedAt: null,
  };
}

export async function getSiteProfile(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<SiteProfile> {
  requirePermission(ctx, "establishments.read");
  await getEstablishment(tx, ctx, establishmentId);
  const { rows } = await tx.query<SiteProfile>(
    `SELECT ${COLUMNS} FROM establishment_profiles WHERE organization_id = $1 AND establishment_id = $2`,
    [ctx.organizationId, establishmentId],
  );
  return rows[0] ?? emptyProfile(establishmentId);
}

/** Crea la fila del perfil si no existe y la bloquea para la edición. */
async function lockProfile(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  await tx.query(
    `INSERT INTO establishment_profiles (organization_id, establishment_id) VALUES ($1, $2)
     ON CONFLICT (establishment_id) DO NOTHING`,
    [ctx.organizationId, establishmentId],
  );
  await tx.query(
    "SELECT 1 FROM establishment_profiles WHERE organization_id = $1 AND establishment_id = $2 FOR UPDATE",
    [ctx.organizationId, establishmentId],
  );
}

export async function updateSiteProfile(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<SiteProfile> {
  requirePermission(ctx, "establishments.update");
  const data = parseInput(updateSiteSchema, input);
  await getEstablishment(tx, ctx, establishmentId);
  if (data.featuredMenuId) {
    // La FK compuesta solo garantiza la organización; la carta debe ser de este local.
    const menu = await tx.query(
      "SELECT 1 FROM menus WHERE organization_id = $1 AND establishment_id = $2 AND id = $3",
      [ctx.organizationId, establishmentId, data.featuredMenuId],
    );
    if (menu.rowCount !== 1) {
      throw new ValidationError("Carta no válida", { featuredMenuId: ["Elige una carta de este local"] });
    }
  }
  if (data.published && !data.heroTitle) {
    throw new ValidationError("Falta el titular", { heroTitle: ["Escribe un titular antes de publicar la página"] });
  }
  await lockProfile(tx, ctx, establishmentId);
  const { rows } = await tx.query<SiteProfile>(
    `UPDATE establishment_profiles
        SET theme = $3, tagline = $4, hero_eyebrow = $5, hero_title = $6, hero_text = $7, phone = $8,
            whatsapp = $9, instagram = $10, highlights = $11, featured_menu_id = $12, published = $13
      WHERE organization_id = $1 AND establishment_id = $2
      RETURNING ${COLUMNS}`,
    [
      ctx.organizationId,
      establishmentId,
      data.theme,
      data.tagline,
      data.heroEyebrow,
      data.heroTitle,
      data.heroText,
      data.phone,
      data.whatsapp,
      data.instagram,
      JSON.stringify(data.highlights),
      data.featuredMenuId,
      data.published,
    ],
  );
  await recordAudit(tx, ctx, {
    action: "site.updated",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { published: data.published },
  });
  return rows[0]!;
}

/** Cambia solo el estilo de la página (el contenido no se toca). */
export async function setSiteTheme(tx: Tx, ctx: TenantContext, establishmentId: string, input: unknown): Promise<void> {
  requirePermission(ctx, "establishments.update");
  const { theme } = parseInput(z.object({ theme: z.enum(MENU_THEMES) }).strict(), input);
  await getEstablishment(tx, ctx, establishmentId);
  await lockProfile(tx, ctx, establishmentId);
  await tx.query("UPDATE establishment_profiles SET theme = $3 WHERE organization_id = $1 AND establishment_id = $2", [
    ctx.organizationId,
    establishmentId,
    theme,
  ]);
  await recordAudit(tx, ctx, {
    action: "site.theme_set",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { theme },
  });
}

export async function setSiteHeroImage(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  bytes: Uint8Array | null,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  await getEstablishment(tx, ctx, establishmentId);
  await lockProfile(tx, ctx, establishmentId);
  const image = bytes ? await storeImage(tx, ctx, bytes) : null;
  await tx.query(
    "UPDATE establishment_profiles SET hero_media_id = $3 WHERE organization_id = $1 AND establishment_id = $2",
    [ctx.organizationId, establishmentId, image?.id ?? null],
  );
  await recordAudit(tx, ctx, {
    action: image ? "site.hero_image_set" : "site.hero_image_removed",
    entityType: "establishment",
    entityId: establishmentId,
  });
}

// ---------------------------------------------------------------------------
// Lectura pública (sin sesión)
// ---------------------------------------------------------------------------

export interface PublicSite {
  organizationName: string;
  establishmentName: string;
  establishmentId: string;
  timezone: string;
  address: string | null;
  theme: MenuTheme;
  tagline: string | null;
  heroEyebrow: string | null;
  heroTitle: string | null;
  heroText: string | null;
  heroMediaId: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  highlights: SiteHighlight[];
  featuredMenuSlug: string | null;
  featuredMenuCode: string | null;
  bookingEnabled: boolean;
  openingHours: { weekday: number; opensMinute: number; durationMinutes: number }[];
  /** Idiomas adicionales del local y traducciones del perfil (D-033). */
  languages: Language[];
  i18n: Partial<Record<Language, Record<string, unknown>>>;
}

/**
 * La web con sus textos en `lang`. Cada campo sin traducir se queda en
 * español; los destacados se traducen uno a uno.
 */
export function localizePublicSite(site: PublicSite, lang: PublicLanguage): PublicSite {
  if (lang === "es" || !site.languages.includes(lang)) return site;
  const e = site.i18n[lang] ?? {};
  const str = (key: string, fallback: string | null) =>
    typeof e[key] === "string" && e[key] ? (e[key] as string) : fallback;
  const hl = Array.isArray(e.highlights) ? (e.highlights as { title?: unknown; text?: unknown }[]) : [];
  return {
    ...site,
    tagline: str("tagline", site.tagline),
    heroEyebrow: str("heroEyebrow", site.heroEyebrow),
    heroTitle: str("heroTitle", site.heroTitle),
    heroText: str("heroText", site.heroText),
    highlights: site.highlights.map((h, n) => ({
      ...h,
      title: typeof hl[n]?.title === "string" && hl[n]!.title ? (hl[n]!.title as string) : h.title,
      text: typeof hl[n]?.text === "string" && hl[n]!.text ? (hl[n]!.text as string) : h.text,
    })),
  };
}

const publicSlug = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Página pública publicada del local, o null. Solo lee mediante app.public_site*. */
export async function getPublicSite(orgSlug: string, establishmentSlug: string): Promise<PublicSite | null> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => publicSlug.test(s))) return null;
  const pool = getPool();
  const { rows } = await pool.query<{
    establishment_id: string;
    organization_name: string;
    establishment_name: string;
    timezone: string;
    address: string | null;
    theme: MenuTheme;
    tagline: string | null;
    hero_eyebrow: string | null;
    hero_title: string | null;
    hero_text: string | null;
    hero_media_id: string | null;
    phone: string | null;
    whatsapp: string | null;
    instagram: string | null;
    highlights: SiteHighlight[];
    featured_menu_slug: string | null;
    featured_menu_code: string | null;
    booking_enabled: boolean;
    languages: Language[];
    i18n: PublicSite["i18n"];
  }>("SELECT * FROM app.public_site($1, $2)", slugs);
  const r = rows[0];
  if (!r) return null;
  const hours = await pool.query<{ weekday: number; opens_minute: number; duration_minutes: number }>(
    "SELECT * FROM app.public_site_hours($1)",
    [r.establishment_id],
  );
  return {
    organizationName: r.organization_name,
    establishmentName: r.establishment_name,
    establishmentId: r.establishment_id,
    timezone: r.timezone,
    address: r.address,
    theme: r.theme,
    tagline: r.tagline,
    heroEyebrow: r.hero_eyebrow,
    heroTitle: r.hero_title,
    heroText: r.hero_text,
    heroMediaId: r.hero_media_id,
    phone: r.phone,
    whatsapp: r.whatsapp,
    instagram: r.instagram,
    highlights: r.highlights,
    featuredMenuSlug: r.featured_menu_slug,
    featuredMenuCode: r.featured_menu_code,
    bookingEnabled: r.booking_enabled,
    languages: r.languages,
    i18n: r.i18n ?? {},
    openingHours: hours.rows.map((h) => ({
      weekday: h.weekday,
      opensMinute: h.opens_minute,
      durationMinutes: h.duration_minutes,
    })),
  };
}

// ---------------------------------------------------------------------------
// Vista previa para el panel (también sin publicar)
// ---------------------------------------------------------------------------

export interface SitePreview {
  profile: SiteProfile;
  establishmentName: string;
  establishmentSlug: string;
  organizationSlug: string;
  address: string | null;
  openingHours: { weekday: number; opensMinute: number; durationMinutes: number }[];
  bookingEnabled: boolean;
  /** Slug de la carta destacada solo si está publicada. */
  featuredMenuSlug: string | null;
}

/** Datos de la página tal como está guardada (publicada o no), para miembros. */
export async function getSitePreview(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<SitePreview> {
  const profile = await getSiteProfile(tx, ctx, establishmentId);
  const est = await getEstablishment(tx, ctx, establishmentId);
  const { rows } = await tx.query<{
    organization_slug: string;
    booking_enabled: boolean;
    featured_menu_slug: string | null;
  }>(
    `SELECT o.slug::text AS organization_slug,
            COALESCE((SELECT s.public_enabled FROM reservation_settings s
                       WHERE s.organization_id = o.id AND s.establishment_id = $2), false) AS booking_enabled,
            (SELECT m.slug::text FROM menus m
              WHERE m.organization_id = o.id AND m.establishment_id = $2 AND m.id = $3
                AND m.published_version_id IS NOT NULL) AS featured_menu_slug
       FROM organizations o WHERE o.id = $1`,
    [ctx.organizationId, establishmentId, profile.featuredMenuId],
  );
  const hours = await tx.query<{ weekday: number; opensMinute: number; durationMinutes: number }>(
    `SELECT weekday, opens_minute AS "opensMinute", duration_minutes AS "durationMinutes"
       FROM opening_hours WHERE organization_id = $1 AND establishment_id = $2 ORDER BY weekday, opens_minute`,
    [ctx.organizationId, establishmentId],
  );
  const r = rows[0]!;
  return {
    profile,
    establishmentName: est.name,
    establishmentSlug: est.slug,
    organizationSlug: r.organization_slug,
    address: est.address,
    openingHours: hours.rows,
    bookingEnabled: r.booking_enabled,
    featuredMenuSlug: r.featured_menu_slug,
  };
}
