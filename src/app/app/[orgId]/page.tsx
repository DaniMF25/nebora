import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
import { withTenant } from "@/server/tenancy/context";
import { createEstablishmentAction } from "./actions";

export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishments: await listEstablishments(tx, ctx),
      // Solo controla qué se muestra; el servidor vuelve a comprobarlo en la acción.
      canCreate: ctx.permissions.has("establishments.create"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <>
      <section>
        <h2>Establecimientos</h2>
        {data.establishments.length === 0 ? (
          <p className="muted">No hay establecimientos todavía.</p>
        ) : (
          <ul className="cards">
            {data.establishments.map((e) => (
              <li key={e.id}>
                <strong>{e.name}</strong> <span className="muted">· {e.timezone}</span>
                {e.address && <div className="muted">{e.address}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.canCreate && (
        <section>
          <h2>Nuevo establecimiento</h2>
          <ActionForm action={createEstablishmentAction.bind(null, orgId)} submitLabel="Crear establecimiento">
            <label>
              Nombre
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Identificador (URL)
              <input name="slug" required placeholder="centro" />
            </label>
            <label>
              Zona horaria
              <input name="timezone" defaultValue="Europe/Madrid" required />
            </label>
            <label>
              Dirección (opcional)
              <input name="address" maxLength={300} />
            </label>
          </ActionForm>
        </section>
      )}
    </>
  );
}
