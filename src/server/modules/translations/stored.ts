import "server-only";
import { createHash } from "node:crypto";
import type { Language } from "@/lib/languages";
import type { Tx } from "@/server/db/pool";
import type { TenantContext } from "@/server/tenancy/context";

// Lectura de las columnas i18n (migración 0019). Sin dependencias de otros
// módulos de negocio: lo usan las cartas (instantánea) y las traducciones.

/** Valor guardado en una columna i18n: idioma → campos traducidos + huella. */
export type StoredI18n = Partial<Record<Language, Record<string, unknown>>>;

export type TranslationStatus = "missing" | "stale" | "done";

/** Huella corta del texto de origen (no es un secreto: solo detecta cambios). */
export function sourceHash(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function entryFor(i18n: StoredI18n | null | undefined, lang: Language): Record<string, unknown> {
  const e = i18n?.[lang];
  return e && typeof e === "object" ? e : {};
}

export function text(entry: Record<string, unknown>, key: string): string {
  const v = entry[key];
  return typeof v === "string" ? v : "";
}

/**
 * Traducciones que lleva la instantánea al publicar: solo idiomas activos del
 * local y solo campos con texto (las desactualizadas también, mejor que nada;
 * el panel avisa de ellas).
 */
export async function snapshotTranslations(
  tx: Tx,
  ctx: TenantContext,
  menuId: string,
  sectionIds: string[],
  productIds: string[],
): Promise<{
  languages: Language[];
  menu: Partial<Record<Language, string>>;
  sections: Map<string, Partial<Record<Language, { name: string }>>>;
  products: Map<string, Partial<Record<Language, { name?: string; description?: string }>>>;
}> {
  const head = await tx.query<{ languages: Language[]; i18n: StoredI18n }>(
    `SELECT e.languages, m.i18n FROM menus m
       JOIN establishments e ON e.organization_id = m.organization_id AND e.id = m.establishment_id
      WHERE m.organization_id = $1 AND m.id = $2`,
    [ctx.organizationId, menuId],
  );
  const languages = head.rows[0]?.languages ?? [];
  const pick = (i18n: StoredI18n | null | undefined, keys: string[]) => {
    const out: Partial<Record<Language, Record<string, string>>> = {};
    for (const lang of languages) {
      const e = entryFor(i18n, lang);
      const fields = Object.fromEntries(keys.map((k) => [k, text(e, k)]).filter(([, v]) => v));
      if (Object.keys(fields).length > 0) out[lang] = fields;
    }
    return out;
  };
  const menu = Object.fromEntries(
    Object.entries(pick(head.rows[0]?.i18n, ["name"])).map(([l, f]) => [l, f.name!]),
  ) as Partial<Record<Language, string>>;
  const sections = new Map<string, Partial<Record<Language, { name: string }>>>();
  if (languages.length > 0 && sectionIds.length > 0) {
    const { rows } = await tx.query<{ id: string; i18n: StoredI18n }>(
      "SELECT id, i18n FROM menu_sections WHERE organization_id = $1 AND id = ANY ($2::uuid[])",
      [ctx.organizationId, sectionIds],
    );
    for (const r of rows) sections.set(r.id, pick(r.i18n, ["name"]) as Partial<Record<Language, { name: string }>>);
  }
  const products = new Map<string, Partial<Record<Language, { name?: string; description?: string }>>>();
  if (languages.length > 0 && productIds.length > 0) {
    const { rows } = await tx.query<{ id: string; i18n: StoredI18n }>(
      "SELECT id, i18n FROM menu_products WHERE organization_id = $1 AND id = ANY ($2::uuid[])",
      [ctx.organizationId, productIds],
    );
    for (const r of rows) products.set(r.id, pick(r.i18n, ["name", "description"]));
  }
  return { languages, menu, sections, products };
}

