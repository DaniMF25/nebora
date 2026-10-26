import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { formatCentsNumeric } from "@/lib/money";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment, listEstablishments } from "@/server/modules/establishments/service";
import { listWarehouses } from "@/server/modules/inventory/service";
import { listOrders, listSuppliers } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { createOrderAction } from "./actions";
import { ORDER_STATUS_LABELS } from "./order-status";

/**
 * Pedidos de compra de un local (los que van a sus almacenes) o de todo el
 * grupo (`establishmentId` ausente). Los proveedores son comunes.
 */
export async function PurchasingScreen({ orgId, establishmentId }: { orgId: string; establishmentId?: string }) {
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: establishmentId ? await getEstablishment(tx, ctx, establishmentId) : null,
      establishments: establishmentId ? [] : await listEstablishments(tx, ctx),
      suppliers: await listSuppliers(tx, ctx),
      orders: await listOrders(tx, ctx, establishmentId),
      warehouses: ctx.permissions.has("inventory.read") ? await listWarehouses(tx, ctx, establishmentId) : [],
      canManage: ctx.permissions.has("purchasing.manage"),
      canSeeCosts: ctx.permissions.has("costs.read"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, establishments, suppliers, orders, warehouses, canManage, canSeeCosts } = data;
  // Con un solo local, la vista del grupo es la del local.
  if (!establishment && establishments.length === 1) {
    redirect(`/app/${orgId}/establishments/${establishments[0]!.id}/purchasing`);
  }
  const activeSuppliers = suppliers.filter((s) => s.active);
  const group = !establishment;

  return (
    <>
      {establishment && (
        <p>
          <Link href={`/app/${orgId}/establishments/${establishment.id}`}>← {establishment.name}</Link>
        </p>
      )}
      <h2>{establishment ? "Compras" : "Compras del grupo"}</h2>
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
                    <td>{group ? `${o.establishmentName} · ${o.warehouseName}` : o.warehouseName}</td>
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
            <p className="muted">
              Para crear pedidos necesitas un proveedor activo y un almacén.{" "}
              {activeSuppliers.length === 0 && <Link href={`/app/${orgId}/suppliers`}>Crear un proveedor</Link>}
              {activeSuppliers.length === 0 && warehouses.length === 0 && " · "}
              {warehouses.length === 0 && (
                <Link
                  href={
                    establishment
                      ? `/app/${orgId}/establishments/${establishment.id}/inventory?tab=almacenes`
                      : `/app/${orgId}/inventory?tab=almacenes`
                  }
                >
                  Crear un almacén
                </Link>
              )}
            </p>
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
                        {group ? `${w.establishmentName} · ${w.name}` : w.name}
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
    </>
  );
}
