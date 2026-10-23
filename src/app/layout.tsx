import type { Metadata } from "next";
import { panelSans, panelSerif } from "@/components/panel/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nébora",
  description: "Gestión de restaurantes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${panelSans.variable} ${panelSerif.variable}`}>{children}</body>
    </html>
  );
}
