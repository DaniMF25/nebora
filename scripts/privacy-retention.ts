// Tarea programable (p. ej. diaria): aplica el plazo de conservación de datos
// de clientes en todas las organizaciones y elimina huellas antiguas del
// límite de peticiones. Usa DATABASE_ADMIN_URL (rol de operaciones). Debe
// programarse en el despliegue: sin ello, la anonimización solo ocurre al
// pulsar «Aplicar ahora» en la interfaz.
import pg from "pg";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("Falta DATABASE_ADMIN_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows: orgs } = await client.query<{ id: string }>("SELECT id FROM organizations ORDER BY id");
  let total = 0;
  for (const org of orgs) {
    // Una transacción por organización: un fallo no bloquea a las demás.
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ n: number }>("SELECT app.anonymize_expired_reservations($1) AS n", [org.id]);
      await client.query("COMMIT");
      total += rows[0]!.n;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`Organización ${org.id}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
  const purged = await client.query<{ n: number }>("SELECT app.purge_rate_limits(48) AS n");
  console.log(`Registros de clientes anonimizados (reservas y lista de espera): ${total}. Registros de límite de peticiones eliminados: ${purged.rows[0]!.n}.`);
} finally {
  await client.end();
}
