import {
  Caveat,
  Cormorant_Garamond,
  Courier_Prime,
  Inter,
  Libre_Baskerville,
  Montserrat,
  Orbitron,
  Oswald,
} from "next/font/google";
import type { MenuTheme } from "@/lib/menu-snapshot";

// Fuentes alojadas por la propia aplicación (next/font las descarga al
// compilar): el visitante no hace peticiones a Google. Sin precarga, el
// navegador solo descarga las que usa el tema visible. next/font exige
// opciones literales en cada llamada.
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const orbitron = Orbitron({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-orbitron" });
const caveat = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-caveat" });
const oswald = Oswald({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-oswald" });
const courier = Courier_Prime({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-courier" });
const baskerville = Libre_Baskerville({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "700"], variable: "--font-baskerville" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--font-cormorant" });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-montserrat" });

const BY_THEME: Record<MenuTheme, string[]> = {
  moderno: [inter.variable],
  futurista: [orbitron.variable, inter.variable],
  clasico: [caveat.variable, oswald.variable, courier.variable, baskerville.variable],
  mediterraneo: [cormorant.variable, montserrat.variable],
};

/** Clases que declaran las variables CSS de las fuentes del tema. */
export function themeFontClasses(theme: MenuTheme): string {
  return BY_THEME[theme].join(" ");
}
