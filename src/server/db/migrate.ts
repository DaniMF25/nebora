import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../db/migrations");

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match?.[1]) throw new Error(`Nombre de migración inválido: ${file}`);
    const sql = await readFile(path.join(dir, file), "utf8");
    migrations.push({
      version: match[1],
      name: file,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new Error("Versiones de migración duplicadas");
  return migrations;
}

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción. Falla si
 * una migración ya aplicada ha cambiado (checksum distinto): las migraciones
 * publicadas son inmutables y los cambios requieren una migración nueva.
 */
export async function migrate(client: Client, dir = MIGRATIONS_DIR): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  // Evita que dos procesos migren a la vez.
  await client.query("SELECT pg_advisory_lock(hashtext('nebora_schema_migrations'))");
  try {
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const done: string[] = [];
    for (const m of await loadMigrations(dir)) {
      const existing = applied.get(m.version);
      if (existing) {
        if (existing !== m.checksum) {
          throw new Error(`La migración ${m.name} cambió después de aplicarse`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [m.version, m.name, m.checksum],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${m.name}: ${(err as Error).message}`, { cause: err });
      }
      done.push(m.name);
    }
    return done;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('nebora_schema_migrations'))");
  }
}
