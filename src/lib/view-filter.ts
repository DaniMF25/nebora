/**
 * Decide si una petición a una página pública cuenta como visita. No se
 * cuentan: precargas del navegador o de Next (no las ve nadie), robots e
 * indexadores, ni las visitas de quien tiene sesión en Nébora (el propio
 * restaurante revisando su web). No guarda nada del visitante.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|node-fetch|axios|go-http|java\/|headless|lighthouse|pingdom|uptime|monitor/i;

export interface ViewRequest {
  userAgent: string | null;
  /** Cabeceras de precarga: `next-router-prefetch`, `purpose`, `sec-purpose`. */
  prefetch: boolean;
  hasSession: boolean;
}

export function isCountableView(req: ViewRequest): boolean {
  if (req.prefetch || req.hasSession) return false;
  const ua = req.userAgent?.trim();
  if (!ua) return false;
  return !BOT_PATTERN.test(ua);
}

export function isPrefetchRequest(get: (name: string) => string | null): boolean {
  return (
    get("next-router-prefetch") !== null ||
    /prefetch/i.test(get("purpose") ?? "") ||
    /prefetch|prerender/i.test(get("sec-purpose") ?? "")
  );
}
