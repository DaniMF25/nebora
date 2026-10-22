// Aplica migraciones con DATABASE_ADMIN_URL (rol propietario del esquema).
// Nunca uses este script contra producción sin revisión previa de las migraciones.
import pg from "pg";
import { migrate } from "../src/server/db/migrate";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Falta DATABASE_ADMIN_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await migrate(client);
  console.log(applied.length ? `Aplicadas: ${applied.join(", ")}` : "Sin migraciones pendientes");
} finally {
  await client.end();
}
