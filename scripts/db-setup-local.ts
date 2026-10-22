// Preparación SOLO para desarrollo local: crea la base de datos indicada en
// DATABASE_ADMIN_URL si no existe, aplica migraciones y habilita el inicio de
// sesión del rol `nebora_app` con NEBORA_APP_DB_PASSWORD.
import pg from "pg";
import { migrate } from "../src/server/db/migrate";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.NEBORA_APP_DB_PASSWORD;
if (!adminUrl || !appPassword) {
  console.error("Faltan DATABASE_ADMIN_URL o NEBORA_APP_DB_PASSWORD (ver .env.example)");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("Este script no debe ejecutarse en producción");
  process.exit(1);
}

const target = new URL(adminUrl);
const dbName = decodeURIComponent(target.pathname.slice(1));
if (!/^[a-z0-9_]+$/.test(dbName)) {
  console.error("Nombre de base de datos no válido");
  process.exit(1);
}

const maintenance = new URL(adminUrl);
maintenance.pathname = "/postgres";
const root = new pg.Client({ connectionString: maintenance.toString() });
await root.connect();
try {
  const exists = await root.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) {
    await root.query(`CREATE DATABASE ${dbName}`);
    console.log(`Base de datos ${dbName} creada`);
  }
} finally {
  await root.end();
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const applied = await migrate(client);
  console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Sin migraciones pendientes");
  const escaped = await client.query<{ lit: string }>("SELECT quote_literal($1) AS lit", [appPassword]);
  await client.query(`ALTER ROLE nebora_app WITH LOGIN PASSWORD ${escaped.rows[0]!.lit}`);
  console.log("Rol nebora_app habilitado para inicio de sesión");
} finally {
  await client.end();
}
