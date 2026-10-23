import type { Allergen } from "./allergens";

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
  sections: {
    name: string;
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
    }[];
  }[];
}
