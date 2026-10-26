import type { Allergen } from "./allergens";
import type { Language, PublicLanguage } from "./languages";

export const MENU_THEMES = ["moderno", "clasico", "futurista", "mediterraneo"] as const;
export type MenuTheme = (typeof MENU_THEMES)[number];

export const MENU_THEME_LABELS: Record<MenuTheme, string> = {
  moderno: "Moderno",
  clasico: "Clásico",
  futurista: "Futurista",
  mediterraneo: "Mediterráneo",
};

/**
 * Contenido congelado de una versión publicada. Es lo único que lee la página
 * pública: no contiene datos de borrador ni más identificadores que el de
 * las fotos.
 */
export interface MenuSnapshot {
  schemaVersion: 1;
  /** El tema forma parte de la versión: cambiarlo requiere volver a publicar. */
  theme: MenuTheme;
  organizationName: string;
  establishmentName: string;
  menuName: string;
  currency: "EUR";
  /**
   * Idiomas adicionales ofrecidos al publicar y traducciones (D-033). Ausentes
   * en versiones sin traducir: se muestra el español.
   */
  languages?: Language[];
  menuNameI18n?: Partial<Record<Language, string>>;
  sections: {
    name: string;
    i18n?: Partial<Record<Language, { name: string }>>;
    items: {
      name: string;
      description: string | null;
      priceCents: number;
      allergens: Allergen[];
      /**
       * Foto del plato. Es el identificador público de la imagen (no da acceso
       * a nada más): app.public_media solo la sirve si figura en una versión
       * publicada. Ausente en versiones anteriores a la migración 0013.
       */
      imageId?: string;
      /** Destacado como «recomendado». */
      recommended?: boolean;
      i18n?: Partial<Record<Language, { name?: string; description?: string }>>;
    }[];
  }[];
}

/**
 * La instantánea con los textos en `lang`; lo que no esté traducido se queda
 * en español. Solo usa idiomas que la versión ofrecía al publicarse.
 */
export function localizeSnapshot(snapshot: MenuSnapshot, lang: PublicLanguage): MenuSnapshot {
  if (lang === "es" || !snapshot.languages?.includes(lang)) return snapshot;
  return {
    ...snapshot,
    menuName: snapshot.menuNameI18n?.[lang] || snapshot.menuName,
    sections: snapshot.sections.map((s) => ({
      ...s,
      name: s.i18n?.[lang]?.name || s.name,
      items: s.items.map((i) => ({
        ...i,
        name: i.i18n?.[lang]?.name || i.name,
        description: i.i18n?.[lang]?.description || i.description,
      })),
    })),
  };
}
