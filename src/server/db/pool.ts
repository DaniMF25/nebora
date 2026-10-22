import "server-only";
import pg from "pg";
import { getEnv } from "@/server/config/env";

export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;

/** Pool del rol de aplicación `nebora_app` (sujeto a RLS). */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
    // Un error de un cliente inactivo no debe tumbar el proceso.
    pool.on("error", (err) => {
      console.error("[db] error en conexión inactiva", { message: err.message });
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}

/**
 * Ejecuta `fn` en una transacción. Las variables de contexto fijadas con
 * `set_config(..., true)` dentro de ella se descartan al terminar, por lo que no
 * se filtran a otras peticiones que reutilicen la conexión.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string };
  return e.code === PG_UNIQUE_VIOLATION && (!constraint || e.constraint === constraint);
}
