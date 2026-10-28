/** Iconos disponibles para los puntos destacados de la página pública del local. */
export const HIGHLIGHT_ICONS = ["chef", "leaf", "fish", "wine", "fire", "star", "heart", "sun"] as const;
export type HighlightIcon = (typeof HIGHLIGHT_ICONS)[number];

export const HIGHLIGHT_ICON_LABELS: Record<HighlightIcon, string> = {
  chef: "Cocina",
  leaf: "Producto fresco",
  fish: "Mar",
  wine: "Vinos",
  fire: "Brasa",
  star: "Calidad",
  heart: "Hecho con cariño",
  sun: "Terraza",
};

export const MAX_HIGHLIGHTS = 3;

export interface SiteHighlight {
  icon: HighlightIcon;
  title: string;
  text: string;
}

/** Ruta pública de una imagen (solo se sirve si la usa contenido publicado). */
export function publicMediaUrl(id: string): string {
  return `/media/${id}`;
}

/** Ruta privada de una imagen para el panel (requiere sesión y pertenencia). */
export function privateMediaUrl(orgId: string, id: string): string {
  return `/app/${orgId}/media/${id}`;
}

/** Tamaños del logotipo en la cabecera de la web (D-034). */
export const LOGO_SIZES = ["small", "medium", "large"] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];
export const LOGO_SIZE_LABELS: Record<LogoSize, string> = { small: "Pequeño", medium: "Mediano", large: "Grande" };
