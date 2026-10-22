import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ALLERGENS, ALLERGEN_LABELS } from "@/lib/allergens";
import { centsNumericToInput, formatCentsNumeric } from "@/lib/money";
import { BASE_UNIT_LABELS, BASE_UNITS, formatQuantity, INPUT_UNITS, type InputUnit } from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
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
  createIngredientAction,
  createWarehouseAction,
  recordMovementAction,
  setIngredientActiveAction,
  updateIngredientDetailsAction,
} from "./actions";

const COST_UNIT: Record<string, string> = { g: "€/kg", ml: "€/l", unit: "€/ud." };

const KIND_LABELS: Record<MovementKind, string> = {
  receipt: "Entrada",
  consumption: "Consumo",
  waste: "Merma",
  adjustment: "Ajuste",
  correction: "Corrección",
};

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function InventoryPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canManage = ctx.permissions.has("inventory.manage");
      return {
        stock: await listStock(tx, ctx),
        movements: await listMovements(tx, ctx, 30),
        ingredients: await listIngredients(tx, ctx),
        warehouses: await listWarehouses(tx, ctx),
        establishments: canManage ? await listEstablishments(tx, ctx) : [],
        canMove: ctx.permissions.has("inventory.move"),
        canManage,
        canSeeCosts: ctx.permissions.has("costs.read"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { stock, movements, ingredients, warehouses, establishments, canMove, canManage, canSeeCosts } = data;
  const activeIngredients = ingredients.filter((i) => i.active);

  return (
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
                    <td>{l.warehouseName}</td>
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
            <p className="muted">Necesitas al menos un almacén y un ingrediente.</p>
          ) : (
            <ActionForm action={recordMovementAction.bind(null, orgId)} submitLabel="Registrar movimiento">
              {/* Nueva clave en cada renderizado: un reenvío del mismo formulario no duplica el movimiento. */}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <label>
                Almacén
                <select name="warehouseId">
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.establishmentName} · {w.name}
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
                    <td>{m.warehouseName}</td>
                    <td>{m.createdByName ?? "—"}</td>
                    {canManage && (
                      <td>
                        {m.kind !== "correction" && !m.correctedByMovementId && (
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
        <p className="muted">Los movimientos no se editan ni se borran: anular crea un movimiento de signo contrario.</p>
      </section>

      <section>
        <h2>Ingredientes</h2>
        {ingredients.length === 0 ? (
          <p className="muted">No hay ingredientes.</p>
        ) : (
          <ul className="cards">
            {ingredients.map((i) => (
              <li key={i.id}>
                <strong>{i.name}</strong> <span className="muted">· {BASE_UNIT_LABELS[i.baseUnit]}</span>
                {i.reorderLevel && <span className="muted"> · mínimo {formatQuantity(i.reorderLevel, i.baseUnit)}</span>}
                {!i.active && <span className="muted"> · archivado</span>}
                {canSeeCosts && (
                  <span className="muted">
                    {" "}
                    · coste{" "}
                    {i.costCentsPerRef ? `${formatCentsNumeric(i.costCentsPerRef)} ${COST_UNIT[i.baseUnit]!.slice(1)}` : "sin definir"}
                  </span>
                )}
                {i.allergens.length > 0 && (
                  <div className="muted">Alérgenos: {i.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}</div>
                )}
                {canManage && (
                  <details>
                    <summary>Editar {i.name}</summary>
                    <ActionForm action={updateIngredientDetailsAction.bind(null, orgId, i.id)} submitLabel="Guardar">
                      <label>
                        Coste ({COST_UNIT[i.baseUnit]})
                        <input
                          name="cost"
                          inputMode="decimal"
                          placeholder="Sin definir"
                          defaultValue={i.costCentsPerRef ? centsNumericToInput(i.costCentsPerRef) : ""}
                        />
                      </label>
                      <label>
                        Nivel mínimo ({BASE_UNIT_LABELS[i.baseUnit]})
                        <input
                          name="reorderLevel"
                          inputMode="decimal"
                          defaultValue={i.reorderLevel ? i.reorderLevel.replace(/\.?0+$/, "").replace(".", ",") : ""}
                        />
                      </label>
                      <fieldset className="allergens">
                        <legend>Alérgenos</legend>
                        {ALLERGENS.map((a) => (
                          <label key={a} className="inline-form" htmlFor={`${i.id}-${a}`}>
                            <input
                              id={`${i.id}-${a}`}
                              type="checkbox"
                              name="allergens"
                              value={a}
                              defaultChecked={i.allergens.includes(a)}
                            />
                            {ALLERGEN_LABELS[a]}
                          </label>
                        ))}
                      </fieldset>
                    </ActionForm>
                  </details>
                )}
                {canManage && (
                  <ActionForm
                    action={setIngredientActiveAction.bind(null, orgId, i.id, !i.active)}
                    submitLabel={i.active ? `Archivar ${i.name}` : `Reactivar ${i.name}`}
                    className="inline-form"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <details>
            <summary>Nuevo ingrediente</summary>
            <ActionForm action={createIngredientAction.bind(null, orgId)} submitLabel="Crear ingrediente">
              <label>
                Nombre del ingrediente
                <input name="name" required maxLength={120} />
              </label>
              <label>
                Unidad base
                <select name="baseUnit" defaultValue="g">
                  {BASE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {BASE_UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nivel mínimo en unidad base (opcional)
                <input name="reorderLevel" inputMode="decimal" placeholder="2000" />
              </label>
            </ActionForm>
          </details>
        )}
      </section>

      <section>
        <h2>Almacenes</h2>
        {warehouses.length === 0 ? (
          <p className="muted">No hay almacenes.</p>
        ) : (
          <ul>
            {warehouses.map((w) => (
              <li key={w.id}>
                {w.establishmentName} · {w.name}
              </li>
            ))}
          </ul>
        )}
        {canManage && establishments.length > 0 && (
          <details>
            <summary>Nuevo almacén</summary>
            <ActionForm action={createWarehouseAction.bind(null, orgId)} submitLabel="Crear almacén">
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
              <label>
                Nombre del almacén
                <input name="name" required maxLength={120} placeholder="Cámara frigorífica" />
              </label>
            </ActionForm>
          </details>
        )}
      </section>
    </>
  );
}
