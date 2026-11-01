/**
 * ¿Viene la petición de una página de la propia aplicación? Compara el host de
 * la cabecera Origin con el que ve el navegador (X-Forwarded-Host detrás de un
 * proxy, si no Host), como hace Next.js con las Server Actions. Detrás de un
 * proxy, request.url puede ser http:// interno aunque el navegador use https.
 * Para Route Handlers que cambian o exportan datos (D-044).
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  return host !== "" && originHost === host;
}
