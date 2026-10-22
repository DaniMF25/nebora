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
 * pública: no contiene identificadores internos ni datos de borrador.
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
    }[];
  }[];
}
