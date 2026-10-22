/**
 * Devuelve `target` solo si es una ruta relativa interna; si no, `fallback`.
 * Evita redirecciones abiertas (`//evil.com`, `https://…`, `/\evil.com`).
 */
export function safeRedirectPath(target: unknown, fallback = "/app"): string {
  if (typeof target !== "string" || target.length > 512) return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(target)) return fallback;
  return target;
}
