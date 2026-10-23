// Preparación de la base de datos de un entorno desplegado (idempotente).
// Con un usuario administrador del servidor PostgreSQL (DATABASE_SUPERUSER_URL):
//   1. crea o actualiza el rol propietario `nebora_admin` (sin superusuario);
//   2. crea la base de datos si no existe, propiedad de `nebora_admin`;
//   3. aplica las migraciones como `nebora_admin`;
//   4. habilita el inicio de sesión de `nebora_app` (sin privilegios, sujeto a RLS).
// No muestra contraseñas ni URLs. Revisa las migraciones antes de usarlo en producción.
import pg from "pg";
import { migrate } from "../src/server/db/migrate";

const superUrl = process.env.DATABASE_SUPERUSER_URL;
const dbName = process.env.NEBORA_DB_NAME ?? "nebora";
const adminPassword = process.env.NEBORA_ADMIN_DB_PASSWORD;
const appPassword = process.env.NEBORA_APP_DB_PASSWORD;

if (!superUrl || !adminPassword || !appPassword) {
  console.error("Faltan DATABASE_SUPERUSER_URL, NEBORA_ADMIN_DB_PASSWORD o NEBORA_APP_DB_PASSWORD");
  process.exit(1);
}
if (!/^[a-z0-9_]+$/.test(dbName)) {
  console.error("Nombre de base de datos no válido");
  process.exit(1);
}
if (adminPassword.length < 24 || appPassword.length < 24) {
  console.error("Las contraseñas deben tener al menos 24 caracteres");
  process.exit(1);
}

async function literal(client: pg.Client, value: string): Promise<string> {
  const { rows } = await client.query<{ lit: string }>("SELECT quote_literal($1) AS lit", [value]);
  return rows[0]!.lit;
}

const root = new pg.Client({ connectionString: superUrl });
await root.connect();
try {
  const role = await root.query("SELECT 1 FROM pg_roles WHERE rolname = 'nebora_admin'");
  const verb = role.rowCount ? "ALTER" : "CREATE";
  await root.query(
    `${verb} ROLE nebora_admin WITH LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE PASSWORD ${await literal(root, adminPassword)}`,
  );
  console.log(`Rol nebora_admin ${role.rowCount ? "actualizado" : "creado"}`);
  const db = await root.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!db.rowCount) {
    await root.query(`CREATE DATABASE ${dbName} OWNER nebora_admin`);
    console.log(`Base de datos ${dbName} creada`);
  }
} finally {
  await root.end();
}

const adminUrl = new URL(superUrl);
adminUrl.username = "nebora_admin";
adminUrl.password = adminPassword;
adminUrl.pathname = `/${dbName}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const applied = await migrate(admin);
  console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Sin migraciones pendientes");
  await admin.query(`ALTER ROLE nebora_app WITH LOGIN PASSWORD ${await literal(admin, appPassword)}`);
  console.log("Rol nebora_app habilitado");
} finally {
  await admin.end();
}
