import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { formatQuantity, INPUT_UNITS, unitsFor, type BaseUnit, type InputUnit } from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getCount } from "@/server/modules/inventory/operations";
import { withTenant } from "@/server/tenancy/context";
import { applyCountAction, cancelCountAction, saveCountLinesAction } from "../../actions";

const STATUS: Record<string, string> = { open: "Abierto", applied: "Aplicado", cancelled: "Cancelado" };
const DEFAULT_UNIT: Record<BaseUnit, InputUnit> = { g: "kg", ml: "l", unit: "unit" };
const dateFormat = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

/** Cantidad guardada (unidad base, "1500.000") como texto del formulario en esa unidad ("1500"). */
function baseToInput(value: string): string {
  return value.replace(/\.?0+$/, "").replace(".", ",");
}

function signed(value: string, base: BaseUnit): string {
  if (/^-?0(\.0+)?$/.test(value)) return "sin diferencia";
  return `${value.startsWith("-") ? "−" : "+"}${formatQuantity(value.replace(/^-/, ""), base)}`;
}

export default async function CountPage({ params }: { params: Promise<{ orgId: string; countId: string }> }) {
  const { orgId, countId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      count: await getCount(tx, ctx, countId),
      canCount: ctx.permissions.has("inventory.move"),
      canApply: ctx.permissions.has("inventory.manage"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { count, canCount, canApply } = data;
  const open = count.status === "open";

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/inventory?tab=recuentos`}>← Inventario</Link>
      </p>
      <h2>
        Recuento de {count.establishmentName} · {count.warehouseName}
      </h2>
      <p className="muted">
        {STATUS[count.status]} · iniciado {dateFormat.format(count.createdAt)}
        {count.createdByName && ` por ${count.createdByName}`}
        {count.closedAt && ` · cerrado ${dateFormat.format(count.closedAt)}`}
        {count.note && ` · ${count.note}`}
      </p>

      {open && canCount && (
        <section>
          <h3>Cantidades contadas</h3>
          <p className="muted">
            Escribe lo que hay físicamente. Deja en blanco lo que no hayas contado (no se tocará). No se muestra el
            stock del sistema para no condicionar el recuento.
          </p>
          <ActionForm action={saveCountLinesAction.bind(null, orgId, count.id)} submitLabel="Guardar recuento">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Contado</th>
                  </tr>
                </thead>
                <tbody>
                  {count.lines.map((l) => (
                    <tr key={l.ingredientId}>
                      <td>{l.ingredientName}</td>
                      <td>
                        <input type="hidden" name="ingredientId" value={l.ingredientId} readOnly />
                        <span className="inline-form">
                          <input
                            name={`q-${l.ingredientId}`}
                            inputMode="decimal"
                            size={8}
                            aria-label={`Cantidad contada de ${l.ingredientName}`}
                            defaultValue={l.counted !== null ? baseToInput(l.counted) : ""}
                          />
                          <select
                            name={`u-${l.ingredientId}`}
                            aria-label={`Unidad de ${l.ingredientName}`}
                            defaultValue={l.counted !== null ? l.baseUnit : DEFAULT_UNIT[l.baseUnit]}
                          >
                            {unitsFor(l.baseUnit).map((u) => (
                              <option key={u} value={u}>
                                {INPUT_UNITS[u].label}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </section>
      )}

      {open && !canCount && <p className="muted">No tienes permiso para registrar cantidades.</p>}

      {open && canApply && (
        <section>
          <h3>Cerrar el recuento</h3>
          <p className="muted">
            Aplicar ajusta el stock de cada artículo contado a la cantidad contada, calculando la diferencia con el
            stock de ese momento. No se puede deshacer; para corregirlo, haz otro recuento.
          </p>
          <div className="inline-form">
            <ActionForm
              action={applyCountAction.bind(null, orgId, count.id)}
              submitLabel="Aplicar recuento"
              className="inline-form"
            />
            <ActionForm
              action={cancelCountAction.bind(null, orgId, count.id)}
              submitLabel="Cancelar recuento"
              className="inline-form"
            />
          </div>
        </section>
      )}

      {!open && (
        <section>
          <h3>Resultado</h3>
          {count.lines.length === 0 ? (
            <p className="muted">No se contó ningún artículo.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th>Contado</th>
                    {count.status === "applied" && <th>En sistema</th>}
                    {count.status === "applied" && <th>Ajuste</th>}
                  </tr>
                </thead>
                <tbody>
                  {count.lines.map((l) => (
                    <tr key={l.ingredientId}>
                      <td>{l.ingredientName}</td>
                      <td>{formatQuantity(l.counted!, l.baseUnit)}</td>
                      {count.status === "applied" && <td>{formatQuantity(l.expected!, l.baseUnit)}</td>}
                      {count.status === "applied" && <td>{signed(l.difference!, l.baseUnit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
