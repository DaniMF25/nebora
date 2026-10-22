import pg from "pg";
import { inject } from "vitest";

/** Conexión con el rol propietario: SOLO para preparar datos en pruebas. */
export async function withAdminClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("adminDatabaseUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Conexión directa con el rol de aplicación, para probar RLS sin la capa de servicios. */
export async function withAppClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject("appDatabaseUrl") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
