import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageTabs, pickTab } from "@/components/panel/page-tabs";
import { BASE_UNIT_LABELS, formatQuantity, INPUT_UNITS, type InputUnit } from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment, listEstablishments } from "@/server/modules/establishments/service";
import { listCounts, listTransfers } from "@/server/modules/inventory/operations";
import {
  listIngredients,
  listMovements,
  listStock,
  listWarehouses,
  type MovementKind,
} from "@/server/modules/inventory/service";
import { withTenant } from "@/server/tenancy/context";
import {
  correctMovementAction,
  createWarehouseAction,
  openCountAction,
  recordMovementAction,
  transferStockAction,
} from "./actions";

const KIND_LABELS: Record<MovementKind, string> = {
  receipt: "Entrada",
  consumption: "Consumo",
  waste: "Merma",
  adjustment: "Ajuste",
  correction: "Corrección",
  transfer_out: "Traspaso (salida)",
  transfer_in: "Traspaso (entrada)",
  count: "Recuento",
};

const COUNT_STATUS: Record<string, string> = { open: "abierto", applied: "aplicado", cancelled: "cancelado" };

const dateFormat = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

export const INVENTORY_TABS = ["stock", "movimientos", "recuentos", "almacenes"] as const;

/**
 * Inventario de un local (sus almacenes) o de todo el grupo (`establishmentId`
 * ausente). Los datos se filtran en el servidor; el catálogo de ingredientes
 * es común y se gestiona en su propia página.
 */
export async function InventoryScreen({
  orgId,
  establishmentId,
  requestedTab,
}: {
  orgId: string;
  establishmentId?: string;
  requestedTab: string | undefined;
}) {
  const tab = pickTab(requestedTab, INVENTORY_TABS);
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canManage = ctx.permissions.has("inventory.manage");
      const establishment = establishmentId ? await getEstablishment(tx, ctx, establishmentId) : null;
      return {
        establishment,
        stock: await listStock(tx, ctx, establishmentId),
        movements: await listMovements(tx, ctx, 30, establishmentId),
        transfers: await listTransfers(tx, ctx, 10, establishmentId),
        counts: await listCounts(tx, ctx, 10, establishmentId),
        ingredients: await listIngredients(tx, ctx),
        // Los traspasos pueden ir a cualquier almacén visible del grupo.
        allWarehouses: await listWarehouses(tx, ctx),
        establishments: establishmentId ? [] : await listEstablishments(tx, ctx),
        canMove: ctx.permissions.has("inventory.move"),
        canManage,
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment, stock, movements, transfers, counts, ingredients, allWarehouses, establishments } = data;
  const { canMove, canManage } = data;
  // Con un solo local, la vista del grupo es la del local.
  if (!establishment && establishments.length === 1) {
    redirect(`/app/${orgId}/establishments/${establishments[0]!.id}/inventory${requestedTab ? `?tab=${tab}` : ""}`);
  }
  const warehouses = establishment ? allWarehouses.filter((w) => w.establishmentId === establishment.id) : allWarehouses;
  const activeIngredients = ingredients.filter((i) => i.active);
  const group = !establishment;
  const basePath = establishment
    ? `/app/${orgId}/establishments/${establishment.id}/inventory`
    : `/app/${orgId}/inventory`;
  // En la vista de un local, el almacén se nombra solo; en la del grupo, con su local.
  const whLabel = (w: { establishmentName: string; warehouseName?: string; name?: string }) =>
    group ? `${w.establishmentName} · ${w.warehouseName ?? w.name}` : (w.warehouseName ?? w.name);

  const tabs = [
    { id: "stock", label: "Stock" },
    { id: "movimientos", label: "Movimientos" },
    { id: "recuentos", label: "Recuentos" },
    { id: "almacenes", label: "Almacenes" },
  ];

  return (
    <>
      {establishment && (
        <p>
          <Link href={`/app/${orgId}/establishments/${establishment.id}`}>← {establishment.name}</Link>
        </p>
      )}
      <h2>{establishment ? "Inventario" : "Inventario del grupo"}</h2>
      {group && (
        <p className="muted">
          Todos los locales juntos. Para trabajar con uno solo, entra en el inventario de ese local.
        </p>
      )}
      <PageTabs tabs={tabs} current={tab} basePath={basePath} />

      {tab === "stock" && (
        <>
          <section>
            <h2>Stock</h2>
            {stock.length === 0 ? (
              <p className="muted">Sin existencias registradas. Registra una entrada para empezar.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Almacén</th>
                      <th>Ingrediente</th>
                      <th>Cantidad</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((l) => (
                      <tr key={`${l.warehouseId}-${l.ingredientId}`}>
                        <td>{whLabel(l)}</td>
                        <td>{l.ingredientName}</td>
                        <td>{formatQuantity(l.quantity, l.baseUnit)}</td>
                        <td>
                          {l.belowReorder ? (
                            <strong>Bajo mínimo ({formatQuantity(l.reorderLevel!, l.baseUnit)})</strong>
                          ) : (
                            <span className="muted">Correcto</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {canMove && (
            <section>
              <h2>Registrar movimiento</h2>
              {warehouses.length === 0 || activeIngredients.length === 0 ? (
                <p className="muted">
                  Necesitas al menos un almacén y un ingrediente.{" "}
                  {warehouses.length === 0 && <Link href={`${basePath}?tab=almacenes`}>Crear un almacén</Link>}
                  {warehouses.length === 0 && activeIngredients.length === 0 && " · "}
                  {activeIngredients.length === 0 && (
                    <Link href={`/app/${orgId}/ingredients`}>Crear ingredientes en el catálogo</Link>
                  )}
                </p>
              ) : (
                <ActionForm action={recordMovementAction.bind(null, orgId)} submitLabel="Registrar movimiento">
                  {/* Nueva clave en cada renderizado: un reenvío del mismo formulario no duplica el movimiento. */}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
                  <label>
                    Almacén
                    <select name="warehouseId">
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {whLabel(w)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ingrediente
                    <select name="ingredientId">
                      {activeIngredients.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({BASE_UNIT_LABELS[i.baseUnit]})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tipo
                    <select name="kind" defaultValue="receipt">
                      <option value="receipt">Entrada</option>
                      <option value="consumption">Consumo</option>
                      <option value="waste">Merma</option>
                      <option value="adjustment">Ajuste</option>
                    </select>
                  </label>
                  <label>
                    Sentido del ajuste (solo para ajustes)
                    <select name="direction" defaultValue="increase">
                      <option value="increase">Aumenta el stock</option>
                      <option value="decrease">Disminuye el stock</option>
                    </select>
                  </label>
                  <div className="inline-form">
                    <label>
                      Cantidad
                      <input name="quantity" inputMode="decimal" required placeholder="1,5" size={10} />
                    </label>
                    <label>
                      Unidad
                      <select name="unit" defaultValue="kg">
                        {(Object.keys(INPUT_UNITS) as InputUnit[]).map((u) => (
                          <option key={u} value={u}>
                            {INPUT_UNITS[u].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Nota (opcional)
                    <input name="note" maxLength={300} />
                  </label>
                </ActionForm>
              )}
            </section>
          )}
        </>
      )}

      {tab === "movimientos" && (
        <>
          {canMove && warehouses.length > 0 && allWarehouses.length >= 2 && activeIngredients.length > 0 && (
            <section>
              <h2>Traspaso entre almacenes</h2>
              <ActionForm action={transferStockAction.bind(null, orgId)} submitLabel="Registrar traspaso">
                <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
                <div className="inline-form">
                  <label>
                    Desde
                    <select name="fromWarehouseId">
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.establishmentName} · {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Hacia
                    <select
                      name="toWarehouseId"
                      defaultValue={allWarehouses.find((w) => w.id !== warehouses[0]?.id)?.id}
                    >
                      {allWarehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.establishmentName} · {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Ingrediente a traspasar
                  <select name="ingredientId">
                    {activeIngredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({BASE_UNIT_LABELS[i.baseUnit]})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="inline-form">
                  <label>
                    Cantidad a traspasar
                    <input name="quantity" inputMode="decimal" required placeholder="2" size={10} />
                  </label>
                  <label>
                    Unidad del traspaso
                    <select name="unit" defaultValue="kg">
                      {(Object.keys(INPUT_UNITS) as InputUnit[]).map((u) => (
                        <option key={u} value={u}>
                          {INPUT_UNITS[u].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Nota del traspaso (opcional)
                  <input name="note" maxLength={300} />
                </label>
              </ActionForm>
              {transfers.length > 0 && (
                <ul className="muted">
                  {transfers.map((t) => (
                    <li key={t.id}>
                      {dateFormat.format(t.createdAt)} · {formatQuantity(t.quantity, t.baseUnit)} de {t.ingredientName}:{" "}
                      {t.fromEstablishmentName} · {t.fromWarehouseName} → {t.toEstablishmentName} · {t.toWarehouseName}
                      {t.createdByName && ` · ${t.createdByName}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h2>Movimientos recientes</h2>
            {movements.length === 0 ? (
              <p className="muted">Todavía no hay movimientos.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Ingrediente</th>
                      <th>Cantidad</th>
                      <th>Almacén</th>
                      <th>Por</th>
                      {canManage && <th>Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td>{dateFormat.format(m.createdAt)}</td>
                        <td>
                          {KIND_LABELS[m.kind]}
                          {m.correctedByMovementId && <span className="muted"> (anulado)</span>}
                          {m.note && <div className="muted">{m.note}</div>}
                        </td>
                        <td>{m.ingredientName}</td>
                        <td>
                          {m.quantityDelta.startsWith("-") ? "−" : "+"}
                          {formatQuantity(m.quantityDelta.replace(/^-/, ""), m.baseUnit)}
                        </td>
                        <td>{whLabel(m)}</td>
                        <td>{m.createdByName ?? "—"}</td>
                        {canManage && (
                          <td>
                            {/* Traspasos y recuentos se compensan con otro traspaso o recuento, no se anulan sueltos. */}
                            {!["correction", "transfer_out", "transfer_in", "count"].includes(m.kind) &&
                              !m.correctedByMovementId && (
                                <ActionForm
                                  action={correctMovementAction.bind(null, orgId, m.id, randomUUID())}
                                  submitLabel="Anular"
                                  className="inline-form"
                                />
                              )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted">
              Los movimientos no se editan ni se borran: anular crea un movimiento de signo contrario.
            </p>
          </section>
        </>
      )}

      {tab === "recuentos" && (
        <section>
          <h2>Recuentos físicos</h2>
          <p className="muted">
            Cuenta lo que hay realmente en un almacén. Al aplicarlo, el stock de cada artículo contado se ajusta a lo
            contado y la diferencia queda registrada.
          </p>
          {counts.length === 0 ? (
            <p className="muted">Todavía no hay recuentos.</p>
          ) : (
            <ul className="cards">
              {counts.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/${orgId}/inventory/counts/${c.id}`}>
                    Recuento de {c.establishmentName} · {c.warehouseName}
                  </Link>{" "}
                  <span className="muted">
                    · {COUNT_STATUS[c.status]} · {c.lineCount} {c.lineCount === 1 ? "artículo" : "artículos"} ·{" "}
                    {dateFormat.format(c.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canMove && warehouses.length > 0 && activeIngredients.length > 0 && (
            <ActionForm action={openCountAction.bind(null, orgId)} submitLabel="Empezar recuento">
              <label>
                Almacén a contar
                <select name="warehouseId">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {whLabel(w)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nota del recuento (opcional)
                <input name="note" maxLength={300} placeholder="Cierre de mes" />
              </label>
            </ActionForm>
          )}
        </section>
      )}

      {tab === "almacenes" && (
        <section>
          <h2>Almacenes</h2>
          {warehouses.length === 0 ? (
            <p className="muted">No hay almacenes.</p>
          ) : (
            <ul>
              {warehouses.map((w) => (
                <li key={w.id}>{whLabel(w)}</li>
              ))}
            </ul>
          )}
          {canManage && (establishment || establishments.length > 0) && (
            <details>
              <summary>Nuevo almacén</summary>
              <ActionForm action={createWarehouseAction.bind(null, orgId)} submitLabel="Crear almacén">
                {establishment ? (
                  <input type="hidden" name="establishmentId" value={establishment.id} readOnly />
                ) : (
                  <label>
                    Establecimiento
                    <select name="establishmentId">
                      {establishments.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Nombre del almacén
                  <input name="name" required maxLength={120} placeholder="Cámara frigorífica" />
                </label>
              </ActionForm>
            </details>
          )}
        </section>
      )}
    </>
  );
}
