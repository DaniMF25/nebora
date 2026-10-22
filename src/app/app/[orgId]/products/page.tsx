import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ProductFields } from "@/components/product-fields";
import { ALLERGEN_LABELS } from "@/lib/allergens";
import { formatEuros } from "@/lib/money";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { listProducts } from "@/server/modules/menus/products";
import { withTenant } from "@/server/tenancy/context";
import { createProductAction, deleteProductAction, updateProductAction } from "./actions";

export default async function ProductsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      products: await listProducts(tx, ctx),
      canEdit: ctx.permissions.has("menus.edit"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  return (
    <>
      <section>
        <h2>Productos</h2>
        <p className="muted">Catálogo común a todos los establecimientos. Las cartas usan estos productos.</p>
        {data.products.length === 0 ? (
          <p className="muted">Todavía no hay productos.</p>
        ) : (
          <ul className="cards">
            {data.products.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong> · {formatEuros(p.priceCents)}
                {!p.active && <span className="muted"> · archivado</span>}
                {p.description && <div className="muted">{p.description}</div>}
                {p.allergens.length > 0 && (
                  <div className="muted">Alérgenos: {p.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}</div>
                )}
                {data.canEdit && (
                  <details>
                    <summary>Editar {p.name}</summary>
                    <ActionForm action={updateProductAction.bind(null, orgId, p.id)} submitLabel="Guardar cambios">
                      <ProductFields idPrefix={p.id} defaults={p} />
                    </ActionForm>
                    <ActionForm
                      action={deleteProductAction.bind(null, orgId, p.id)}
                      submitLabel={`Eliminar ${p.name}`}
                      className="inline-form"
                    />
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.canEdit && (
        <section>
          <h2>Nuevo producto</h2>
          <ActionForm action={createProductAction.bind(null, orgId)} submitLabel="Crear producto">
            <ProductFields idPrefix="new" />
          </ActionForm>
        </section>
      )}
    </>
  );
}
