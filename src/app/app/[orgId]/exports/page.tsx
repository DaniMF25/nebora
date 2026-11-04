import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
import {
  availableExports,
  MAX_EXPORT_DAYS,
  MAX_EXPORT_ROWS,
  SNAPSHOT_KINDS,
  type ExportKind,
} from "@/server/modules/exports/service";
import { localDateOf } from "@/server/modules/schedules/time";
import { requirePermission, withTenant } from "@/server/tenancy/context";

const INFO: Record<ExportKind, { title: string; description: string }> = {
  reservations: {
    title: "Reservas",
    description: "Fecha, hora, comensales, estado, cliente y contacto, notas, mesas y origen (panel o web).",
  },
  messages: {
    title: "Mensajes de la web",
    description: "Los mensajes del formulario de contacto con su motivo, contacto y estado (también los archivados).",
  },
  shifts: { title: "Turnos", description: "Cada turno con la persona, el puesto, el horario y las horas." },
  stock: { title: "Stock actual", description: "Existencias de cada ingrediente por almacén, con su mínimo." },
  movements: {
    title: "Movimientos de inventario",
    description: "Entradas, consumos, mermas, ajustes, traspasos y recuentos, con quién los registró.",
  },
};

/** Exportaciones a CSV (D-058): solo las que permiten el rol y el plan; el servidor lo vuelve a comprobar al descargar. */
export default async function ExportsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      requirePermission(ctx, "data.export");
      return { kinds: availableExports(ctx), establishments: await listEstablishments(tx, ctx) };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const today = localDateOf(new Date(), data.establishments[0]?.timezone ?? "Europe/Madrid");
  const monthStart = `${today.slice(0, 8)}01`;

  return (
    <>
      <h2>Exportar datos</h2>
      <p className="muted">
        Descarga tus datos en CSV para abrirlos en Excel, Numbers o Google Sheets. Las fechas son las de cada local y el
        periodo incluye los dos días. Como máximo {MAX_EXPORT_DAYS} días y {MAX_EXPORT_ROWS.toLocaleString("es-ES")} filas
        por archivo. Cada descarga queda registrada.
      </p>
      <p className="muted">
        Contienen datos personales de clientes: guárdalos de forma segura y bórralos cuando ya no los necesites.
      </p>
      {data.establishments.length === 0 ? (
        <p>Todavía no hay locales.</p>
      ) : (
        <div className="export-grid">
          {data.kinds.map((kind) => {
            const snapshot = SNAPSHOT_KINDS.includes(kind);
            return (
              <section key={kind} aria-labelledby={`exportar-${kind}`} className="export-card">
                <h3 id={`exportar-${kind}`}>{INFO[kind].title}</h3>
                <p className="muted">{INFO[kind].description}</p>
                <form method="post" action={`/app/${orgId}/exports/${kind}`} className="form">
                  <label>
                    Local
                    <select name="establishmentId" defaultValue="">
                      {data.establishments.length > 1 && <option value="">Todos los locales</option>}
                      {data.establishments.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!snapshot && (
                    <div className="inline-form">
                      <label>
                        Desde
                        <input type="date" name="from" required defaultValue={monthStart} />
                      </label>
                      <label>
                        Hasta
                        <input type="date" name="to" required defaultValue={today} />
                      </label>
                    </div>
                  )}
                  <button type="submit">Descargar CSV</button>
                </form>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
