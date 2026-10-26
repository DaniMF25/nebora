import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listSuppliers } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { createSupplierAction, setSupplierActiveAction } from "../purchasing/actions";

/** Proveedores: comunes a todos los locales del grupo. */
export default async function SuppliersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      suppliers: await listSuppliers(tx, ctx),
      canManage: ctx.permissions.has("catalog.manage"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { suppliers, canManage } = data;

  return (
    <>
      <section>
        <h2>Proveedores</h2>
        <p className="muted">Comunes a todos los locales. Los pedidos se hacen desde las compras de cada local.</p>
        {suppliers.length === 0 ? (
          <p className="muted">No hay proveedores.</p>
        ) : (
          <ul className="cards">
            {suppliers.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong>
                {!s.active && <span className="muted"> · archivado</span>}
                {(s.contactName || s.email || s.phone) && (
                  <div className="muted">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ")}</div>
                )}
                {s.notes && <div className="muted">{s.notes}</div>}
                {canManage && (
                  <ActionForm
                    action={setSupplierActiveAction.bind(null, orgId, s.id, !s.active)}
                    submitLabel={s.active ? `Archivar ${s.name}` : `Reactivar ${s.name}`}
                    className="inline-form"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <details>
            <summary>Nuevo proveedor</summary>
            <ActionForm action={createSupplierAction.bind(null, orgId)} submitLabel="Crear proveedor">
              <label>
                Nombre del proveedor
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Persona de contacto (opcional)
                <input name="contactName" maxLength={120} />
              </label>
              <label>
                Correo (opcional)
                <input name="email" type="email" maxLength={254} />
              </label>
              <label>
                Teléfono (opcional)
                <input name="phone" maxLength={40} />
              </label>
              <label>
                Notas (opcional)
                <input name="notes" maxLength={500} />
              </label>
            </ActionForm>
          </details>
        )}
      </section>
    </>
  );
}
