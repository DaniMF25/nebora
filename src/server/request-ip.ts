import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/server/config/env";

type HeaderGetter = { get(name: string): string | null };

/**
 * IP del cliente según las cabeceras. Con `trustedHeader` (la que fija el proxy
 * de la plataforma, p. ej. Fly-Client-IP) solo se usa esa: X-Forwarded-For
 * puede traer valores enviados por el propio cliente y añadidos por el proxy.
 * Sin ella, primera IP de X-Forwarded-For o X-Real-IP; en ese caso el proxy
 * debe sobrescribir esas cabeceras.
 */
export function pickClientIp(h: HeaderGetter, trustedHeader?: string): string {
  if (trustedHeader) return h.get(trustedHeader)?.trim() || "desconocido";
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || "desconocido";
}

/** Identificador del cliente para limitar peticiones. Solo se almacena su hash. */
export async function clientIdentifier(): Promise<string> {
  return pickClientIp(await headers(), getEnv().CLIENT_IP_HEADER);
}
