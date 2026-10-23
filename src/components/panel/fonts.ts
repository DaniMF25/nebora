import { Fraunces, Inter } from "next/font/google";

// Tipografías del panel, alojadas por la propia aplicación (next/font). Sin
// precarga: la web pública del local no las usa y no debe descargarlas.
export const panelSans = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-panel-sans" });
export const panelSerif = Fraunces({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["500", "600"],
  variable: "--font-panel-serif",
});
