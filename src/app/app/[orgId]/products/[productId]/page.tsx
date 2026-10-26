import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { EstablishmentScopeFields } from "@/components/establishment-scope-fields";
import { ALLERGEN_LABELS } from "@/lib/allergens";
import { formatCentsNumeric, formatEuros } from "@/lib/money";
import { BASE_UNIT_LABELS, formatQuantity, INPUT_UNITS, type InputUnit } from "@/lib/quantity";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listEstablishments } from "@/server/modules/establishments/service";
import { listIngredients, listWarehouses } from "@/server/modules/inventory/service";
import { getProduct } from "@/server/modules/menus/products";
import { getRecipe } from "@/server/modules/recipes/service";
import { privateMediaUrl } from "@/lib/site";
import { withTenant } from "@/server/tenancy/context";
import {
  applyRecipeAllergensAction,
  produceRecipeAction,
  removeProductImageAction,
  removeRecipeLineAction,
  setAvailabilityAction,
  setProductImageAction,
  setRecipeLineAction,
} from "./actions";

export default async function ProductRecipePage({ params }: { params: Promise<{ orgId: string; productId: string }> }) {
  const { orgId, productId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => {
      const canInventory = ctx.permissions.has("inventory.read");
      return {
        recipe: await getRecipe(tx, ctx, productId),
        product: await getProduct(tx, ctx, productId),
        ingredients: canInventory ? (await listIngredients(tx, ctx)).filter((i) => i.active) : [],
        warehouses: canInventory ? await listWarehouses(tx, ctx) : [],
        establishments: (await listEstablishments(tx, ctx)).map((e) => ({ id: e.id, name: e.name })),
        canEdit: ctx.permissions.has("catalog.manage"),
        canProduce: ctx.permissions.has("inventory.move"),
      };
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { recipe, product, ingredients, warehouses, establishments, canEdit, canProduce } = data;
  const estName = new Map(establishments.map((e) => [e.id, e.name]));
  const costing = recipe.costing;

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/products`}>← Productos</Link>
      </p>
      <h2>
        {recipe.productName} <span className="muted">· {formatEuros(recipe.priceCents)}</span>
      </h2>

      {recipe.undeclaredAllergens.length > 0 && (
        <div className="alert" role="status">
          <p>
            La receta contiene alérgenos que el producto no declara en la carta:{" "}
            <strong>{recipe.undeclaredAllergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}</strong>.
          </p>
          {canEdit && (
            <ActionForm
              action={applyRecipeAllergensAction.bind(null, orgId, productId)}
              submitLabel="Declararlos en el producto"
              className="inline-form"
            />
          )}
        </div>
      )}
      <p className="muted">
        Alérgenos declarados en la carta:{" "}
        {recipe.productAllergens.length ? recipe.productAllergens.map((a) => ALLERGEN_LABELS[a]).join(", ") : "ninguno"}
      </p>

      <section>
        <h3>Foto del plato</h3>
        {product.imageMediaId ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por ruta autenticada
          <img
            src={privateMediaUrl(orgId, product.imageMediaId)}
            alt={`Foto de ${product.name}`}
            className="media-thumb"
          />
        ) : (
          <p className="muted">Sin foto.</p>
        )}
        {canEdit && (
          <>
            <ActionForm action={setProductImageAction.bind(null, orgId, productId)} submitLabel="Subir foto">
              <label>
                Imagen (JPEG, PNG o WebP, hasta 8 MB)
                <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
              </label>
            </ActionForm>
            {product.imageMediaId && (
              <ActionForm
                action={removeProductImageAction.bind(null, orgId, productId)}
                submitLabel="Quitar foto"
                className="inline-form"
              />
            )}
            <p className="muted">
              Se guarda una copia reducida sin datos de ubicación ni de la cámara. Las cartas publicadas muestran la foto
              al volver a publicarlas.
            </p>
          </>
        )}
      </section>

      <section>
        <h3>Locales</h3>
        <p className="muted">
          Disponible en:{" "}
          {product.allEstablishments
            ? "todos los locales"
            : product.establishmentIds.map((id) => estName.get(id) ?? "—").join(", ")}
          . Solo las cartas de esos locales pueden incluirlo.
        </p>
        {canEdit && establishments.length > 1 && (
          <ActionForm action={setAvailabilityAction.bind(null, orgId, productId)} submitLabel="Guardar locales">
            <EstablishmentScopeFields
              establishments={establishments}
              allSelected={product.allEstablishments}
              selected={product.establishmentIds}
              idPrefix={`product-${productId}`}
              legend="Disponible en"
            />
          </ActionForm>
        )}
      </section>

      {costing && (
        <section>
          <h3>Escandallo (por ración)</h3>
          {costing.costCents === null ? (
            <p className="notice">
              {recipe.lines.length === 0
                ? "Añade ingredientes a la receta para calcular el coste."
                : `Incompleto: falta el coste de ${costing.missingCosts.join(", ")}. Defínelo en Inventario → Ingredientes.`}
            </p>
          ) : (
            <dl className="kpis">
              <div>
                <dt>Coste</dt>
                <dd>{formatCentsNumeric(costing.costCents)}</dd>
              </div>
              <div>
                <dt>Precio de carta</dt>
                <dd>{formatEuros(recipe.priceCents)}</dd>
              </div>
              <div>
                <dt>Margen bruto</dt>
                <dd>{costing.marginCents !== null ? formatEuros(costing.marginCents) : "—"}</dd>
              </div>
              <div>
                <dt>Coste sobre precio</dt>
                <dd>{costing.costPercent !== null ? `${costing.costPercent.toLocaleString("es-ES")} %` : "—"}</dd>
              </div>
            </dl>
          )}
          <p className="muted">
            Calculado con el coste de referencia de cada ingrediente sobre el precio de carta tal como está introducido
            (si incluye impuestos, el margen también los incluye).
          </p>
        </section>
      )}

      <section>
        <h3>Receta (cantidades por ración)</h3>
        {recipe.lines.length === 0 ? (
          <p className="muted">Sin ingredientes.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Cantidad</th>
                  <th>Alérgenos</th>
                  {costing && <th>Coste</th>}
                  {canEdit && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {recipe.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.ingredientName}
                      {!l.ingredientActive && <span className="muted"> (archivado)</span>}
                    </td>
                    <td>{formatQuantity(l.quantity, l.baseUnit)}</td>
                    <td>{l.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ") || "—"}</td>
                    {costing && <td>{l.lineCostCents ? formatCentsNumeric(l.lineCostCents) : "sin coste"}</td>}
                    {canEdit && (
                      <td>
                        <ActionForm
                          action={removeRecipeLineAction.bind(null, orgId, productId, l.id)}
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
        {canEdit &&
          (ingredients.length === 0 ? (
            <p className="muted">
              No hay ingredientes. <Link href={`/app/${orgId}/ingredients`}>Créalos en el catálogo de ingredientes</Link>.
            </p>
          ) : (
            <ActionForm action={setRecipeLineAction.bind(null, orgId, productId)} submitLabel="Añadir o actualizar">
              <label>
                Ingrediente
                <select name="ingredientId">
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({BASE_UNIT_LABELS[i.baseUnit]})
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline-form">
                <label>
                  Cantidad por ración
                  <input name="quantity" inputMode="decimal" required placeholder="120" size={10} />
                </label>
                <label>
                  Unidad
                  <select name="unit" defaultValue="g">
                    {(Object.keys(INPUT_UNITS) as InputUnit[]).map((u) => (
                      <option key={u} value={u}>
                        {INPUT_UNITS[u].label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </ActionForm>
          ))}
      </section>

      {canProduce && recipe.lines.length > 0 && warehouses.length > 0 && (
        <section>
          <h3>Registrar elaboración</h3>
          <p className="muted">Descuenta del stock los ingredientes de las raciones elaboradas (todo o nada).</p>
          <ActionForm action={produceRecipeAction.bind(null, orgId, productId)} submitLabel="Descontar del stock">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
            <label>
              Almacén de origen
              <select name="warehouseId">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.establishmentName} · {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Raciones
              <input name="portions" type="number" min={1} max={1000} required defaultValue={1} />
            </label>
          </ActionForm>
        </section>
      )}
    </>
  );
}
