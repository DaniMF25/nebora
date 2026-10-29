import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { formatCentsNumeric } from "@/lib/money";
import {
  BASE_UNIT_LABELS,
  formatQuantity,
  fromNumericString,
  INPUT_UNITS,
  toNumericString,
  unitsFor,
  type BaseUnit,
  type InputUnit,
} from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listIngredients } from "@/server/modules/inventory/service";
import { getOrder } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";
import { ORDER_STATUS_LABELS } from "../order-status";
import {
  cancelOrderAction,
  markSentAction,
  receiveOrderAction,
  removeOrderLineAction,
  setOrderLineAction,
} from "./actions";

const PRICE_UNIT: Record<BaseUnit, string> = { g: "€/kg", ml: "€/l", unit: "€/ud." };
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

/** Pendiente expresado en kg/l si es exacto (más cómodo de recibir); si no, en la unidad base. */
function remainingInput(remaining: bigint, base: BaseUnit): { value: string; unit: InputUnit } {
  if (base !== "unit" && remaining % 1000n === 0n) {
    const v = Number(remaining / 1000n) / 1000;
    return { value: v.toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 3 }), unit: base === "g" ? "kg" : "l" };
  }
  return {
    value: (Number(remaining) / 1000).toLocaleString("es-ES", { useGrouping: false, maximumFractionDigits: 3 }),
    unit: base,
  };
}

export default async function OrderPage({ params }: { params: Promise<{ orgId: string; orderId: string }> }) {
  const { orgId, orderId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canManage = ctx.permissions.has("purchasing.manage");
      return {
        order: await getOrder(tx, ctx, orderId),
        ingredients: canManage ? (await listIngredients(tx, ctx)).filter((i) => i.active) : [],
        canManage,
        canReceive: ctx.permissions.has("purchasing.receive"),
        canSeeCosts: ctx.permissions.has("costs.read"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { order, ingredients, canManage, canReceive, canSeeCosts } = data;
  const isDraft = order.status === "draft";
  const receivable = order.status === "sent" || order.status === "partially_received";
  const pending = order.lines
    .map((l) => ({ line: l, remaining: fromNumericString(l.quantityOrdered) - fromNumericString(l.quantityReceived) }))
    .filter((p) => p.remaining > 0n);

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${order.establishmentId}/purchasing`}>
          ← Compras de {order.establishmentName}
        </Link>
      </p>
      <h2>
        Pedido {order.number} · {order.supplierName}
      </h2>
      <p>
        <strong>{ORDER_STATUS_LABELS[order.status]}</strong>
        <span className="muted">
          {" "}
          · destino {order.establishmentName} · {order.warehouseName}
          {order.expectedDate && ` · entrega prevista ${order.expectedDate}`}
          {order.sentAt && ` · marcado como enviado el ${dateTime.format(order.sentAt)}`}
        </span>
      </p>
      {order.notes && <p className="muted">{order.notes}</p>}

      <section>
        <h3>Líneas</h3>
        {order.lines.length === 0 ? (
          <p className="muted">El pedido no tiene líneas.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Pedido</th>
                  <th>Recibido</th>
                  {canSeeCosts && <th>Precio</th>}
                  {canSeeCosts && <th>Importe</th>}
                  {canManage && isDraft && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Ingrediente">{l.ingredientName}</td>
                    <td data-label="Pedido">{formatQuantity(l.quantityOrdered, l.baseUnit)}</td>
                    <td data-label="Recibido">{formatQuantity(l.quantityReceived, l.baseUnit)}</td>
                    {canSeeCosts && (
                      <td data-label="Precio">
                        {l.unitPriceCents && `${formatCentsNumeric(l.unitPriceCents)} ${PRICE_UNIT[l.baseUnit].slice(1)}`}
                      </td>
                    )}
                    {canSeeCosts && <td data-label="Importe">{l.lineTotalCents && formatCentsNumeric(l.lineTotalCents)}</td>}
                    {canManage && isDraft && (
                      <td data-label="Acciones">
                        <ActionForm
                          action={removeOrderLineAction.bind(null, orgId, orderId, l.id)}
                          submitLabel={`Quitar ${l.ingredientName}`}
                          className="inline-form"
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canSeeCosts && order.totalCents && (
          <p>
            <strong>Total: {formatCentsNumeric(order.totalCents)}</strong>{" "}
            <span className="muted">(según los precios introducidos)</span>
          </p>
        )}

        {canManage && isDraft && ingredients.length > 0 && (
          <ActionForm action={setOrderLineAction.bind(null, orgId, orderId)} submitLabel="Añadir o actualizar línea">
            <label>
              Ingrediente
              <select name="ingredientId">
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({BASE_UNIT_LABELS[i.baseUnit]}, precio en {PRICE_UNIT[i.baseUnit]})
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-form">
              <label>
                Cantidad
                <input name="quantity" inputMode="decimal" required size={10} />
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
              <label>
                Precio (€ por kg, l o ud.)
                <input name="unitPrice" inputMode="decimal" required size={10} placeholder="2,15" />
              </label>
            </div>
          </ActionForm>
        )}
      </section>

      {canManage && (isDraft || order.status === "sent") && (
        <section>
          <h3>Estado</h3>
          {isDraft && (
            <p className="muted">
              El envío al proveedor no está integrado (no hay correo configurado): envía el pedido por tu canal habitual y
              márcalo aquí como enviado.
            </p>
          )}
          <div className="inline-form">
            {isDraft && (
              <ActionForm action={markSentAction.bind(null, orgId, orderId)} submitLabel="Marcar como enviado" className="inline-form" />
            )}
            <ActionForm action={cancelOrderAction.bind(null, orgId, orderId)} submitLabel="Cancelar pedido" className="inline-form" />
          </div>
        </section>
      )}

      {canReceive && receivable && pending.length > 0 && (
        <section>
          <h3>Registrar recepción</h3>
          <p className="muted">Indica lo que ha llegado. Deja en blanco lo que no haya llegado.</p>
          <ActionForm action={receiveOrderAction.bind(null, orgId, orderId)} submitLabel="Registrar recepción">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
            {pending.map(({ line, remaining }) => {
              const def = remainingInput(remaining, line.baseUnit);
              return (
                <div key={line.id} className="inline-form">
                  <input type="hidden" name="lineId" value={line.id} readOnly />
                  <label>
                    {line.ingredientName} (pendiente {formatQuantity(toNumericString(remaining), line.baseUnit)})
                    <input name={`qty-${line.id}`} inputMode="decimal" defaultValue={def.value} size={10} />
                  </label>
                  <label>
                    <span className="visually-hidden">Unidad para {line.ingredientName}</span>
                    <select name={`unit-${line.id}`} defaultValue={def.unit}>
                      {unitsFor(line.baseUnit).map((u) => (
                        <option key={u} value={u}>
                          {INPUT_UNITS[u].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })}
            <label>
              Nota (opcional, p. ej. nº de albarán)
              <input name="note" maxLength={300} />
            </label>
            {canSeeCosts ? (
              <label className="inline-form">
                <input type="checkbox" name="updateCosts" defaultChecked /> Actualizar el coste de los ingredientes con
                el precio de este pedido
              </label>
            ) : (
              <input type="hidden" name="updateCosts" value="on" readOnly />
            )}
          </ActionForm>
        </section>
      )}

      <section>
        <h3>Recepciones</h3>
        {order.receipts.length === 0 ? (
          <p className="muted">Sin recepciones.</p>
        ) : (
          <ul className="cards">
            {order.receipts.map((r) => (
              <li key={r.id}>
                <strong>{dateTime.format(r.receivedAt)}</strong>
                {r.receivedByName && <span className="muted"> · {r.receivedByName}</span>}
                {r.note && <span className="muted"> · {r.note}</span>}
                <div>{r.lines.map((l) => `${l.ingredientName}: ${formatQuantity(l.quantity, l.baseUnit)}`).join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
