import type { NextConfig } from "next";

// Cabeceras de seguridad básicas. La CSP, con nonce por petición, la pone
// src/proxy.ts (D-044).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Aísla la ventana de las abiertas desde otros sitios (y viceversa).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // La imagen Docker usa la salida autónoma (server.js con solo las dependencias
  // necesarias). Se activa solo ahí porque `next start` no la admite.
  ...(process.env.NEBORA_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // pg es un módulo de Node con dependencias opcionales nativas; no se empaqueta.
  // sharp (reprocesado de imágenes) es nativo y tampoco se empaqueta.
  serverExternalPackages: ["pg", "sharp"],
  // Subida de fotos por Server Action: 8 MB de imagen más el resto del formulario.
  // El servicio vuelve a comprobar el tamaño y el formato.
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
