// Generado por scripts/fetch-fonts.mjs: no editar a mano (D-043).
// Web pública de Nébora (D-065): con precarga, solo en sus páginas.
import localFont from "next/font/local";

/** Archivo */
export const marketing = localFont({
  src: [
    {
      path: "./archivo-100-900-w62-125.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  display: "optional",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  preload: true,
  variable: "--font-marketing",
});

/** Courier Prime */
export const marketingmono = localFont({
  src: [
    {
      path: "./courier-prime-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./courier-prime-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "optional",
  preload: true,
  variable: "--font-marketing-mono",
});
