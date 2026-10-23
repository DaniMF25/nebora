import "server-only";
import { createHash } from "node:crypto";
import { getPool } from "@/server/db/pool";

/** Huella de un identificador de cliente (IP, contacto): nunca se guarda en claro. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Registra un intento en el contador `bucket` (ventana deslizante) y devuelve
 * false si ya se alcanzó el máximo. Se confirma de inmediato, aunque la
 * operación que protege falle después: los intentos fallidos también cuentan.
 */
export async function hitRateLimit(bucket: string, windowSeconds: number, max: number): Promise<boolean> {
  const { rows } = await getPool().query<{ ok: boolean }>("SELECT app.rate_limit_hit($1, $2, $3) AS ok", [
    bucket,
    windowSeconds,
    max,
  ]);
  return rows[0]!.ok;
}
