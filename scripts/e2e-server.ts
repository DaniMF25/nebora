// Servidor para pruebas E2E: recrea la base de datos `nebora_e2e` desde cero,
// aplica migraciones y arranca `next start` contra ella. Requiere `next build`.
// Solo para entornos locales o de CI, nunca contra producción.
import { spawn } from "node:child_process";
import pg from "pg";
import { migrate } from "../src/server/db/migrate";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.NEBORA_APP_DB_PASSWORD;
const port = process.env.E2E_PORT ?? "3100";
if (!adminUrl || !appPassword) {
  console.error("Faltan DATABASE_ADMIN_URL o NEBORA_APP_DB_PASSWORD");
  process.exit(1);
}

const DB = "nebora_e2e";
const maintenance = new URL(adminUrl);
maintenance.pathname = "/postgres";
const root = new pg.Client({ connectionString: maintenance.toString() });
await root.connect();
await root.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
await root.query(`CREATE DATABASE ${DB}`);
await root.end();

const e2eAdmin = new URL(adminUrl);
e2eAdmin.pathname = `/${DB}`;
const admin = new pg.Client({ connectionString: e2eAdmin.toString() });
await admin.connect();
await migrate(admin);
const lit = await admin.query<{ lit: string }>("SELECT quote_literal($1) AS lit", [appPassword]);
await admin.query(`ALTER ROLE nebora_app WITH LOGIN PASSWORD ${lit.rows[0]!.lit}`);
await admin.end();

const appUrl = new URL(e2eAdmin);
appUrl.username = "nebora_app";
appUrl.password = encodeURIComponent(appPassword);

const child = spawn("pnpm", ["exec", "next", "start", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: appUrl.toString(),
    AUTH_ALLOW_SIGNUP: "true",
  },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
