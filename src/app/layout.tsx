import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nébora",
  description: "Gestión de restaurantes",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
