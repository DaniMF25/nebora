import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { migrate } from "../../src/server/db/migrate";

declare module "vitest" {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}

/**
 * Crea una base de datos efímera desde cero, aplica todas las migraciones y la
 * elimina al terminar. Las pruebas de integración FALLAN (no se omiten) si no
 * hay PostgreSQL configurado.
 */
export default async function setup(project: TestProject) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appPassword = process.env.NEBORA_APP_DB_PASSWORD;
  if (!adminUrl || !appPassword) {
    throw new Error(
      "Las pruebas de integración requieren DATABASE_ADMIN_URL y NEBORA_APP_DB_PASSWORD (ver README).",
    );
  }

  const dbName = `nebora_test_${randomBytes(6).toString("hex")}`;
  const maintenanceUrl = new URL(adminUrl);
  maintenanceUrl.pathname = "/postgres";

  const root = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await root.connect();
  await root.query(`CREATE DATABASE ${dbName}`);
  await root.end();

  const testAdminUrl = new URL(adminUrl);
  testAdminUrl.pathname = `/${dbName}`;
  const admin = new pg.Client({ connectionString: testAdminUrl.toString() });
  await admin.connect();
  try {
    await migrate(admin);
    const lit = await admin.query<{ lit: string }>("SELECT quote_literal($1) AS lit", [appPassword]);
    await admin.query(`ALTER ROLE nebora_app WITH LOGIN PASSWORD ${lit.rows[0]!.lit}`);
  } finally {
    await admin.end();
  }

  const appUrl = new URL(testAdminUrl);
  appUrl.username = "nebora_app";
  appUrl.password = encodeURIComponent(appPassword);

  project.provide("adminDatabaseUrl", testAdminUrl.toString());
  project.provide("appDatabaseUrl", appUrl.toString());

  return async () => {
    const r = new pg.Client({ connectionString: maintenanceUrl.toString() });
    await r.connect();
    await r.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await r.end();
  };
}
