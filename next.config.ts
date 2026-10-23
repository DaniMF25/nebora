import type { NextConfig } from "next";

// Cabeceras de seguridad básicas. La CSP aquí solo incluye directivas que no
// dependen de nonces para scripts; endurecer script-src queda para la Fase 8.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
