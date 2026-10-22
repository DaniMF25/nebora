import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { formatCentsNumeric } from "@/lib/money";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listWarehouses } from "@/server/modules/inventory/service";
import { listOrders, listSuppliers } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { createOrderAction, createSupplierAction, setSupplierActiveAction } from "./actions";
import { ORDER_STATUS_LABELS } from "./order-status";

export default async function PurchasingPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      suppliers: await listSuppliers(tx, ctx),
      orders: await listOrders(tx, ctx),
      warehouses: ctx.permissions.has("inventory.read") ? await listWarehouses(tx, ctx) : [],
      canManage: ctx.permissions.has("purchasing.manage"),
      canSeeCosts: ctx.permissions.has("costs.read"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { suppliers, orders, warehouses, canManage, canSeeCosts } = data;
  const activeSuppliers = suppliers.filter((s) => s.active);

  return (
    <>
      <section>
        <h2>Pedidos de compra</h2>
        {orders.length === 0 ? (
          <p className="muted">No hay pedidos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Proveedor</th>
                  <th>Destino</th>
                  <th>Estado</th>
                  <th>Entrega prevista</th>
                  {canSeeCosts && <th>Total</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/app/${orgId}/purchasing/${o.id}`}>Pedido {o.number}</Link>
                    </td>
                    <td>{o.supplierName}</td>
                    <td>
                      {o.establishmentName} · {o.warehouseName}
                    </td>
                    <td>{ORDER_STATUS_LABELS[o.status]}</td>
                    <td>{o.expectedDate ?? "—"}</td>
                    {canSeeCosts && <td>{o.totalCents ? formatCentsNumeric(o.totalCents) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage &&
          (activeSuppliers.length === 0 || warehouses.length === 0 ? (
            <p className="muted">Para crear pedidos necesitas un proveedor activo y un almacén.</p>
          ) : (
            <details>
              <summary>Nuevo pedido</summary>
              <ActionForm action={createOrderAction.bind(null, orgId)} submitLabel="Crear pedido">
                <label>
                  Proveedor
                  <select name="supplierId">
                    {activeSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Almacén de destino
                  <select name="warehouseId">
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.establishmentName} · {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Entrega prevista (opcional)
                  <input type="date" name="expectedDate" />
                </label>
                <label>
                  Notas (opcional)
                  <input name="notes" maxLength={500} />
                </label>
              </ActionForm>
            </details>
          ))}
      </section>

      <section>
        <h2>Proveedores</h2>
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
