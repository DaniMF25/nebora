import "server-only";
import { z } from "zod";
import { isLanguage, type Language } from "@/lib/languages";
import type { SiteHighlight } from "@/lib/site";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { getMenuDraft } from "@/server/modules/menus/menus";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import { entryFor, sourceHash, text, type StoredI18n, type TranslationStatus } from "./stored";

export type { TranslationStatus } from "./stored";

// Traducciones manuales de cartas y web (migración 0019, D-033). Cada
// traducción guarda `src`, la huella del texto en español del que se hizo:
// si el original cambia, la traducción se marca como desactualizada.

function statusOf(entry: Record<string, unknown>, fields: string[], hash: string): TranslationStatus {
  if (!fields.some((f) => text(entry, f))) return "missing";
  return entry.src === hash ? "done" : "stale";
}

/** Nueva columna i18n con el idioma sustituido (o quitado si queda vacío). */
function withEntry(i18n: StoredI18n | null, lang: Language, fields: Record<string, string>, hash: string): StoredI18n {
  const next: StoredI18n = { ...(i18n ?? {}) };
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
  if (Object.keys(kept).length === 0) delete next[lang];
  else next[lang] = { ...kept, src: hash };
  return next;
}

const field = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .default("");

function requireLanguage(lang: string, offered: readonly string[]): Language {
  if (!isLanguage(lang) || !offered.includes(lang)) {
    throw new ValidationError("Este idioma no está activado en el local");
  }
  return lang;
}

// ---------------------------------------------------------------------------
// Cartas: nombre, categorías y productos que contiene
// ---------------------------------------------------------------------------

export interface TranslatableField {
  id: string;
  source: { name: string; description?: string | null };
  value: { name: string; description?: string };
  status: TranslationStatus;
}

export interface MenuTranslationForm {
  menuId: string;
  establishmentId: string;
  languages: Language[];
  lang: Language;
  menu: TranslatableField;
  sections: TranslatableField[];
  /** Productos (catálogo común) que aparecen en la carta, sin repetir. */
  products: TranslatableField[];
  /** Los productos son del catálogo común: solo los traduce quien gestiona el catálogo. */
  canEditProducts: boolean;
  summary: { done: number; stale: number; missing: number };
}

const productHash = (name: string, description: string | null) => sourceHash([name, description ?? ""]);

export async function getMenuTranslationForm(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  lang: string | undefined,
): Promise<MenuTranslationForm | null> {
  requirePermission(ctx, "menus.read");
  const draft = await getMenuDraft(tx, ctx, menuId);
  const est = await getEstablishment(tx, ctx, draft.menu.establishmentId);
  if (est.languages.length === 0) return null;
  const language = lang && isLanguage(lang) && est.languages.includes(lang) ? lang : est.languages[0]!;

  const menuRow = await tx.query<{ i18n: StoredI18n }>("SELECT i18n FROM menus WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
  ]);
  const sectionRows = await tx.query<{ id: string; i18n: StoredI18n }>(
    "SELECT id, i18n FROM menu_sections WHERE organization_id = $1 AND menu_id = $2",
    [ctx.organizationId, menuId],
  );
  const productIds = [...new Set(draft.sections.flatMap((s) => s.items.map((i) => i.productId)))];
  const productRows = await tx.query<{ id: string; name: string; description: string | null; i18n: StoredI18n }>(
    "SELECT id, name, description, i18n FROM menu_products WHERE organization_id = $1 AND id = ANY ($2::uuid[])",
    [ctx.organizationId, productIds],
  );
  const sectionI18n = new Map(sectionRows.rows.map((r) => [r.id, r.i18n]));
  const products = new Map(productRows.rows.map((r) => [r.id, r]));

  const menuEntry = entryFor(menuRow.rows[0]?.i18n, language);
  const menu: TranslatableField = {
    id: menuId,
    source: { name: draft.menu.name },
    value: { name: text(menuEntry, "name") },
    status: statusOf(menuEntry, ["name"], sourceHash([draft.menu.name])),
  };
  const sections = draft.sections.map((s): TranslatableField => {
    const e = entryFor(sectionI18n.get(s.id), language);
    return {
      id: s.id,
      source: { name: s.name },
      value: { name: text(e, "name") },
      status: statusOf(e, ["name"], sourceHash([s.name])),
    };
  });
  const productFields = productIds.map((id): TranslatableField => {
    const p = products.get(id)!;
    const e = entryFor(p.i18n, language);
    return {
      id,
      source: { name: p.name, description: p.description },
      value: { name: text(e, "name"), description: text(e, "description") },
      status: statusOf(e, ["name", "description"], productHash(p.name, p.description)),
    };
  });
  const all = [menu, ...sections, ...productFields];
  return {
    menuId,
    establishmentId: est.id,
    languages: est.languages,
    lang: language,
    menu,
    sections,
    products: productFields,
    canEditProducts: ctx.permissions.has("catalog.manage"),
    summary: {
      done: all.filter((f) => f.status === "done").length,
      stale: all.filter((f) => f.status === "stale").length,
      missing: all.filter((f) => f.status === "missing").length,
    },
  };
}

const menuTranslationSchema = z
  .object({
    menuName: field(120),
    sections: z.record(z.string(), field(120)).default({}),
    products: z
      .record(z.string(), z.object({ name: field(120), description: field(500) }).strict())
      .optional(),
  })
  .strict();

/**
 * Guarda las traducciones de una carta a un idioma. Campo vacío = sin
 * traducir. Las traducciones de productos se guardan en el catálogo común
 * (sirven para todas las cartas que los incluyan).
 */
export async function saveMenuTranslations(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  lang: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "menus.edit");
  const data = parseInput(menuTranslationSchema, input);
  if (data.products && !ctx.permissions.has("catalog.manage")) {
    throw new ForbiddenError("Solo quien gestiona el catálogo puede traducir los productos");
  }
  if (!isUuid(menuId)) throw new NotFoundError();
  // Bloquea la carta: serializa con otras ediciones y con la publicación.
  const locked = await tx.query<{ name: string; i18n: StoredI18n; establishment_id: string }>(
    "SELECT name, i18n, establishment_id FROM menus WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [ctx.organizationId, menuId],
  );
  const menu = locked.rows[0];
  if (!menu) throw new NotFoundError();
  const est = await getEstablishment(tx, ctx, menu.establishment_id);
  const language = requireLanguage(lang, est.languages);

  await tx.query("UPDATE menus SET i18n = $3 WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    menuId,
    JSON.stringify(withEntry(menu.i18n, language, { name: data.menuName }, sourceHash([menu.name]))),
  ]);

  const sections = await tx.query<{ id: string; name: string; i18n: StoredI18n }>(
    "SELECT id, name, i18n FROM menu_sections WHERE organization_id = $1 AND menu_id = $2",
    [ctx.organizationId, menuId],
  );
  const byId = new Map(sections.rows.map((s) => [s.id, s]));
  for (const [id, name] of Object.entries(data.sections)) {
    const s = byId.get(id);
    if (!s) throw new NotFoundError("Categoría no encontrada");
    await tx.query("UPDATE menu_sections SET i18n = $3 WHERE organization_id = $1 AND id = $2", [
      ctx.organizationId,
      id,
      JSON.stringify(withEntry(s.i18n, language, { name }, sourceHash([s.name]))),
    ]);
  }

  if (data.products) {
    const ids = Object.keys(data.products);
    const rows = await tx.query<{ id: string; name: string; description: string | null; i18n: StoredI18n }>(
      `SELECT p.id, p.name, p.description, p.i18n
         FROM menu_products p
        WHERE p.organization_id = $1 AND p.id::text = ANY ($3::text[])
          AND EXISTS (SELECT 1 FROM menu_items i
                        JOIN menu_sections s ON s.organization_id = i.organization_id AND s.id = i.section_id
                       WHERE i.organization_id = p.organization_id AND i.product_id = p.id AND s.menu_id = $2)
        FOR UPDATE`,
      [ctx.organizationId, menuId, ids],
    );
    if (rows.rows.length !== ids.length) throw new NotFoundError("Producto no encontrado en esta carta");
    for (const p of rows.rows) {
      const t = data.products[p.id]!;
      await tx.query("UPDATE menu_products SET i18n = $3 WHERE organization_id = $1 AND id = $2", [
        ctx.organizationId,
        p.id,
        JSON.stringify(withEntry(p.i18n, language, t, productHash(p.name, p.description))),
      ]);
    }
  }
  await recordAudit(tx, ctx, {
    action: "menu.translations_saved",
    entityType: "menu",
    entityId: menuId,
    metadata: { lang: language, products: data.products ? Object.keys(data.products).length : 0 },
  });
}

// ---------------------------------------------------------------------------
// Web del local
// ---------------------------------------------------------------------------

export const SITE_TEXT_FIELDS = ["tagline", "heroEyebrow", "heroTitle", "heroText"] as const;
type SiteTextField = (typeof SITE_TEXT_FIELDS)[number];
const SITE_LIMITS: Record<SiteTextField, number> = { tagline: 60, heroEyebrow: 60, heroTitle: 120, heroText: 400 };

export interface SiteTranslationForm {
  establishmentId: string;
  languages: Language[];
  lang: Language;
  source: Record<SiteTextField, string | null> & { highlights: SiteHighlight[] };
  value: Record<SiteTextField, string> & { highlights: { title: string; text: string }[] };
  status: TranslationStatus;
}

interface SiteSourceRow {
  tagline: string | null;
  hero_eyebrow: string | null;
  hero_title: string | null;
  hero_text: string | null;
  highlights: SiteHighlight[];
  i18n: StoredI18n;
}

function siteSource(r: SiteSourceRow | undefined) {
  return {
    tagline: r?.tagline ?? null,
    heroEyebrow: r?.hero_eyebrow ?? null,
    heroTitle: r?.hero_title ?? null,
    heroText: r?.hero_text ?? null,
    highlights: r?.highlights ?? [],
  };
}

const siteHash = (s: ReturnType<typeof siteSource>) =>
  sourceHash([s.tagline, s.heroEyebrow, s.heroTitle, s.heroText, s.highlights.map((h) => [h.title, h.text])]);

export async function getSiteTranslationForm(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  lang: string | undefined,
): Promise<SiteTranslationForm | null> {
  requirePermission(ctx, "establishments.read");
  const est = await getEstablishment(tx, ctx, establishmentId);
  if (est.languages.length === 0) return null;
  const language = lang && isLanguage(lang) && est.languages.includes(lang) ? lang : est.languages[0]!;
  const { rows } = await tx.query<SiteSourceRow>(
    `SELECT tagline, hero_eyebrow, hero_title, hero_text, highlights, i18n
       FROM establishment_profiles WHERE organization_id = $1 AND establishment_id = $2`,
    [ctx.organizationId, establishmentId],
  );
  const source = siteSource(rows[0]);
  const e = entryFor(rows[0]?.i18n, language);
  const storedHighlights = Array.isArray(e.highlights) ? (e.highlights as { title?: unknown; text?: unknown }[]) : [];
  return {
    establishmentId,
    languages: est.languages,
    lang: language,
    source,
    value: {
      tagline: text(e, "tagline"),
      heroEyebrow: text(e, "heroEyebrow"),
      heroTitle: text(e, "heroTitle"),
      heroText: text(e, "heroText"),
      highlights: source.highlights.map((_, n) => ({
        title: typeof storedHighlights[n]?.title === "string" ? (storedHighlights[n]!.title as string) : "",
        text: typeof storedHighlights[n]?.text === "string" ? (storedHighlights[n]!.text as string) : "",
      })),
    },
    status: rows[0]
      ? (() => {
          const any =
            SITE_TEXT_FIELDS.some((f) => text(e, f)) || storedHighlights.some((h) => h?.title || h?.text);
          if (!any) return "missing";
          return e.src === siteHash(source) ? "done" : "stale";
        })()
      : "missing",
  };
}

const siteTranslationSchema = z
  .object({
    tagline: field(SITE_LIMITS.tagline),
    heroEyebrow: field(SITE_LIMITS.heroEyebrow),
    heroTitle: field(SITE_LIMITS.heroTitle),
    heroText: field(SITE_LIMITS.heroText),
    highlights: z
      .array(z.object({ title: field(40), text: field(120) }).strict())
      .max(3)
      .default([]),
  })
  .strict();

export async function saveSiteTranslations(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  lang: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  const data = parseInput(siteTranslationSchema, input);
  const est = await getEstablishment(tx, ctx, establishmentId);
  const language = requireLanguage(lang, est.languages);
  const { rows } = await tx.query<SiteSourceRow>(
    `SELECT tagline, hero_eyebrow, hero_title, hero_text, highlights, i18n
       FROM establishment_profiles WHERE organization_id = $1 AND establishment_id = $2 FOR UPDATE`,
    [ctx.organizationId, establishmentId],
  );
  if (!rows[0]) throw new ValidationError("Guarda primero el contenido de la web en español");
  const source = siteSource(rows[0]);
  const next: StoredI18n = { ...(rows[0].i18n ?? {}) };
  const highlights = source.highlights.map((_, n) => data.highlights[n] ?? { title: "", text: "" });
  const hasText = SITE_TEXT_FIELDS.some((f) => data[f]) || highlights.some((h) => h.title || h.text);
  if (hasText) {
    next[language] = {
      ...Object.fromEntries(SITE_TEXT_FIELDS.map((f) => [f, data[f]]).filter(([, v]) => v)),
      highlights,
      src: siteHash(source),
    };
  } else {
    delete next[language];
  }
  await tx.query("UPDATE establishment_profiles SET i18n = $3 WHERE organization_id = $1 AND establishment_id = $2", [
    ctx.organizationId,
    establishmentId,
    JSON.stringify(next),
  ]);
  await recordAudit(tx, ctx, {
    action: "site.translations_saved",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { lang: language },
  });
}
