import type { Metadata } from "next";
import { connection } from "next/server";
import { panelSans } from "@/components/panel/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nébora",
  description: "Gestión de restaurantes",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Todas las páginas se renderizan por petición: la CSP lleva un nonce nuevo
  // en cada una y Next solo puede ponérselo a sus scripts al renderizar (D-044).
  await connection();
  return (
    <html lang="es">
      <body className={panelSans.variable}>{children}</body>
    </html>
  );
}
