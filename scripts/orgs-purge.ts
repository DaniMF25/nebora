// Tarea programable (diaria): bloquea las organizaciones cuya prueba gratuita
// ha terminado y borra por completo las que llevan más de 15 días bloqueadas
// sin plan (D-068). La web y el panel ya lo aplican al visitarlos; esta tarea
// cubre las organizaciones que nadie visita. Usa DATABASE_ADMIN_URL.
import pg from "pg";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Falta DATABASE_ADMIN_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const locked = await client.query<{ n: number }>("SELECT app.expire_trials() AS n");
  const purged = await client.query<{ n: number }>("SELECT app.purge_locked_organizations() AS n");
  console.log(
    `Organizaciones bloqueadas por fin de la prueba: ${locked.rows[0]!.n}. Organizaciones borradas tras 15 días sin plan: ${purged.rows[0]!.n}.`,
  );
} finally {
  await client.end();
}
