import { NextResponse, type NextRequest } from "next/server";

/**
 * Política de seguridad de contenidos (CSP) con nonce por petición (D-044).
 * Solo se ejecutan los scripts de la propia aplicación que llevan el nonce
 * (Next.js se lo pone a los suyos al renderizar); nada de otros dominios ni
 * scripts inyectados. Los estilos admiten `style=""` en línea (los usan el
 * tema, la marca y la foto principal); imágenes, fuentes y conexiones, solo
 * del propio origen.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  // Solo si la petición llega por HTTPS: en local por http://localhost rompería la carga.
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = [
    "default-src 'self'",
    // En desarrollo React usa eval para las trazas de error; en producción no.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Ruta pedida, para que el panel de una organización bloqueada lleve a «Plan» (D-068).
  // Se sobrescribe siempre: el cliente no puede fijarla.
  requestHeaders.set("x-nebora-path", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // HSTS solo cuando ya se sirve por HTTPS (en local por http rompería el acceso).
  if (https) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}

export const config = {
  matcher: [
    {
      // Todo salvo recursos estáticos de Next (no ejecutan scripts propios) y precargas.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
