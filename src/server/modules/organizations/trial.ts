import "server-only";
import { getPool, type Tx } from "@/server/db/pool";

/**
 * Caducidad de las pruebas gratuitas (D-062, D-068): bloquea las organizaciones
 * cuya prueba ha terminado (app.expire_trials) y borra las que llevan más de 15
 * días bloqueadas sin elegir plan (app.purge_locked_organizations). Se llama
 * antes de servir las páginas públicas; son consultas por índice para todas las
 * organizaciones, así que basta con hacerlas como mucho cada 30 segundos por
 * proceso. `pnpm orgs:purge` hace lo mismo como tarea programada.
 */
const INTERVAL_MS = 30_000;
let nextRunAt = 0;

export async function expireTrialsIfDue(tx?: Tx): Promise<void> {
  const now = Date.now();
  if (now < nextRunAt) return;
  nextRunAt = now + INTERVAL_MS;
  const db = tx ?? getPool();
  await db.query("SELECT app.expire_trials()");
  await db.query("SELECT app.purge_locked_organizations()");
}

/** Solo para las pruebas: la siguiente llamada vuelve a comprobar. */
export function resetTrialExpiryThrottle(): void {
  nextRunAt = 0;
}
