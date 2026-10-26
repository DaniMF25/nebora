import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ALLERGENS, ALLERGEN_LABELS } from "@/lib/allergens";
import { centsNumericToInput, formatCentsNumeric } from "@/lib/money";
import { BASE_UNIT_LABELS, BASE_UNITS, formatQuantity } from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listIngredients } from "@/server/modules/inventory/service";
import { withTenant } from "@/server/tenancy/context";
import { createIngredientAction, setIngredientActiveAction, updateIngredientDetailsAction } from "../inventory/actions";

const COST_UNIT: Record<string, string> = { g: "€/kg", ml: "€/l", unit: "€/ud." };

/** Ingredientes: catálogo común del grupo (el stock va por local). */
export default async function IngredientsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      ingredients: await listIngredients(tx, ctx),
      canManage: ctx.permissions.has("catalog.manage"),
      canSeeCosts: ctx.permissions.has("costs.read"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { ingredients, canManage, canSeeCosts } = data;

  return (
    <>
      <section>
        <h2>Ingredientes</h2>
        <p className="muted">
          Catálogo común a todos los locales: unidad, coste de referencia, alérgenos y nivel mínimo de reposición. El
          stock de cada local se lleva en su inventario.
        </p>
        {ingredients.length === 0 ? (
          <p className="muted">No hay ingredientes.</p>
        ) : (
          <ul className="cards">
            {ingredients.map((i) => (
              <li key={i.id}>
                <strong>{i.name}</strong> <span className="muted">· {BASE_UNIT_LABELS[i.baseUnit]}</span>
                {i.reorderLevel && (
                  <span className="muted"> · mínimo {formatQuantity(i.reorderLevel, i.baseUnit)}</span>
                )}
                {!i.active && <span className="muted"> · archivado</span>}
                {canSeeCosts && (
                  <span className="muted">
                    {" "}
                    · coste{" "}
                    {i.costCentsPerRef
                      ? `${formatCentsNumeric(i.costCentsPerRef)} ${COST_UNIT[i.baseUnit]!.slice(1)}`
                      : "sin definir"}
                  </span>
                )}
                {i.allergens.length > 0 && (
                  <div className="muted">Alérgenos: {i.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}</div>
                )}
                {canManage && (
                  <details>
                    <summary>Editar {i.name}</summary>
                    <ActionForm
                      action={updateIngredientDetailsAction.bind(null, orgId, i.id)}
                      submitLabel="Guardar"
                    >
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
                          defaultValue={
                            i.reorderLevel ? i.reorderLevel.replace(/\.?0+$/, "").replace(".", ",") : ""
                          }
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
    </>
  );
}
