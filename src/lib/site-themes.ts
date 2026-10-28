import type { MenuTheme } from "./menu-snapshot";

/** Presentación de cada estilo de la web del local en el panel (descripción, colores y miniatura). */
export interface ThemeInfo {
  name: string;
  description: string;
  swatches: string[];
  /** Fondo de la página y color de acento por defecto (para el color de marca). */
  pageBg: string;
  accent: string;
  mock: {
    bg: string;
    fg: string;
    accent: string;
    /** Velo sobre la foto principal (rgb). */
    tint: string;
    brandFont: string;
    displayFont: string;
    uppercase: boolean;
  };
}

export const THEME_ORDER: MenuTheme[] = ["mediterraneo", "clasico", "futurista", "moderno"];

export const THEME_INFO: Record<MenuTheme, ThemeInfo> = {
  mediterraneo: {
    name: "Mediterráneo",
    description: "Elegante y sereno: fondo oscuro con detalles dorados y tipografía serif. Para cocina de mercado y de mar.",
    swatches: ["#111418", "#efebe4", "#b48c56", "#17191c", "#f7f4ef"],
    pageBg: "#efebe4",
    accent: "#b48c56",
    mock: {
      bg: "#111418",
      fg: "#f3eee6",
      accent: "#b48c56",
      tint: "14 17 21",
      brandFont: "var(--font-cormorant), Georgia, serif",
      displayFont: "var(--font-cormorant), Georgia, serif",
      uppercase: false,
    },
  },
  clasico: {
    name: "Clásico",
    description: "Cálido y tradicional: papel, azul marino y letra manuscrita. Ideal para tabernas y casas de comidas.",
    swatches: ["#f3ebdc", "#1d2f4a", "#b4412f", "#fbf6ec", "#4f5b6e"],
    pageBg: "#f3ebdc",
    accent: "#1d2f4a",
    mock: {
      bg: "#f3ebdc",
      fg: "#1d2f4a",
      accent: "#1d2f4a",
      tint: "243 235 220",
      brandFont: "var(--font-caveat), cursive",
      displayFont: "var(--font-oswald), sans-serif",
      uppercase: true,
    },
  },
  futurista: {
    name: "Futurista",
    description: "Atrevido y vanguardista: negro con neón violeta y tipografía geométrica. Para cocina creativa.",
    swatches: ["#0a0a14", "#b26bff", "#4fd1ff", "#13132a", "#ecebff"],
    pageBg: "#0a0a14",
    accent: "#b26bff",
    mock: {
      bg: "#0a0a14",
      fg: "#f4f2ff",
      accent: "#b26bff",
      tint: "10 10 20",
      brandFont: "var(--font-orbitron), sans-serif",
      displayFont: "var(--font-orbitron), sans-serif",
      uppercase: true,
    },
  },
  moderno: {
    name: "Moderno",
    description: "Neutro y limpio: blanco y negro con tipografía sin adornos. Encaja con cualquier tipo de cocina.",
    swatches: ["#18181b", "#fafaf9", "#e4572e", "#ffffff", "#5f5f66"],
    pageBg: "#fafaf9",
    accent: "#18181b",
    mock: {
      bg: "#18181b",
      fg: "#ffffff",
      accent: "#ffffff",
      tint: "18 18 22",
      brandFont: "var(--font-inter), sans-serif",
      displayFont: "var(--font-inter), sans-serif",
      uppercase: false,
    },
  },
};
