import "server-only";
import { headers } from "next/headers";

/**
 * Identificador del cliente para limitar peticiones. Usa la primera IP de
 * X-Forwarded-For (que Next.js rellena con la del socket) o X-Real-IP.
 * En producción detrás de un proxy, éste debe sobrescribir esas cabeceras para
 * que el cliente no pueda falsearlas. Solo se almacena su hash.
 */
export async function clientIdentifier(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "desconocido";
}
