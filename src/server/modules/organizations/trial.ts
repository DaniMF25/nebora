import "server-only";
import { getPool, type Tx } from "@/server/db/pool";

/**
 * Caducidad de las pruebas gratuitas (D-062): pasa al plan Básico las
 * organizaciones cuya prueba ha terminado (app.expire_trials). Se llama al
 * entrar al panel y antes de servir las páginas públicas; como es una sola
 * consulta por índice para todas las organizaciones, basta con hacerla como
 * mucho cada 30 segundos por proceso.
 */
const INTERVAL_MS = 30_000;
let nextRunAt = 0;

export async function expireTrialsIfDue(tx?: Tx): Promise<void> {
  const now = Date.now();
  if (now < nextRunAt) return;
  nextRunAt = now + INTERVAL_MS;
  await (tx ?? getPool()).query("SELECT app.expire_trials()");
}

/** Solo para las pruebas: la siguiente llamada vuelve a comprobar. */
export function resetTrialExpiryThrottle(): void {
  nextRunAt = 0;
}
