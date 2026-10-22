import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ALLERGEN_LABELS } from "@/lib/allergens";
import { MENU_THEMES, MENU_THEME_LABELS } from "@/lib/menu-snapshot";
import { centsToInput, formatEuros } from "@/lib/money";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getMenuDraft, listVersions, publicationProblems } from "@/server/modules/menus/menus";
import { listProducts } from "@/server/modules/menus/products";
import { withTenant } from "@/server/tenancy/context";
import {
  activateVersionAction,
  addItemAction,
  addSectionAction,
  deleteMenuAction,
  deleteSectionAction,
  moveItemAction,
  moveSectionAction,
  publishMenuAction,
  removeItemAction,
  renameSectionAction,
  setItemPriceAction,
  unpublishMenuAction,
  updateMenuAction,
} from "./actions";

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });

export default async function MenuEditorPage({ params }: { params: Promise<{ orgId: string; menuId: string }> }) {
  const { orgId, menuId } = await params;
  const user = await requireUser();

  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      draft: await getMenuDraft(tx, ctx, menuId),
      versions: await listVersions(tx, ctx, menuId),
      products: await listProducts(tx, ctx, { activeOnly: true }),
      canEdit: ctx.permissions.has("menus.edit"),
      canPublish: ctx.permissions.has("menus.publish"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }

  const { draft, versions, products, canEdit, canPublish } = data;
  const { menu } = draft;
  const publicPath = `/m/${draft.organizationSlug}/${draft.establishmentSlug}/${menu.slug}`;
  const problems = publicationProblems(draft);

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${menu.establishmentId}`}>← {draft.establishmentName}</Link>
      </p>
      <h2>{menu.name}</h2>
      <p>
        {menu.publishedVersionNumber ? (
          <>
            <strong>Publicada</strong> (versión {menu.publishedVersionNumber}) ·{" "}
            <a href={publicPath} target="_blank" rel="noopener">
              Ver página pública
            </a>
          </>
        ) : (
          <strong>Sin publicar</strong>
        )}{" "}
        · <Link href={`/app/${orgId}/menus/${menuId}/preview`}>Vista previa del borrador</Link>
      </p>

      {canPublish && (
        <section>
          <h3>Publicación</h3>
          <p className="muted">
            Publicar congela el borrador actual en una nueva versión. Los cambios posteriores no se verán en la página
            pública hasta volver a publicar.
          </p>
          {problems.length > 0 && (
            <ul className="muted">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="inline-form">
            <ActionForm action={publishMenuAction.bind(null, orgId, menuId)} submitLabel="Publicar borrador" className="inline-form" />
            {menu.publishedVersionNumber && (
              <ActionForm action={unpublishMenuAction.bind(null, orgId, menuId)} submitLabel="Despublicar" className="inline-form" />
            )}
          </div>
        </section>
      )}

      <section>
        <h3>Borrador</h3>
        {draft.sections.length === 0 && <p className="muted">Añade una categoría para empezar.</p>}
        {draft.sections.map((section, si) => {
          const used = new Set(section.items.map((i) => i.productId));
          const available = products.filter((p) => !used.has(p.id));
          return (
            <div key={section.id} className="menu-section">
              <h4>{section.name}</h4>
              {canEdit && (
                <div className="inline-form">
                  <ActionForm
                    action={renameSectionAction.bind(null, orgId, menuId, section.id)}
                    submitLabel="Renombrar"
                    className="inline-form"
                  >
                    <label>
                      <span className="visually-hidden">Nombre de la categoría {section.name}</span>
                      <input name="name" defaultValue={section.name} required maxLength={120} />
                    </label>
                  </ActionForm>
                  {si > 0 && (
                    <ActionForm
                      action={moveSectionAction.bind(null, orgId, menuId, section.id, "up")}
                      submitLabel={`Subir ${section.name}`}
                      className="inline-form"
                    />
                  )}
                  {si < draft.sections.length - 1 && (
                    <ActionForm
                      action={moveSectionAction.bind(null, orgId, menuId, section.id, "down")}
                      submitLabel={`Bajar ${section.name}`}
                      className="inline-form"
                    />
                  )}
                  <ActionForm
                    action={deleteSectionAction.bind(null, orgId, menuId, section.id)}
                    submitLabel={`Eliminar categoría ${section.name}`}
                    className="inline-form"
                  />
                </div>
              )}
              {section.items.length === 0 ? (
                <p className="muted">Sin productos.</p>
              ) : (
                <ul className="cards">
                  {section.items.map((item, ii) => (
                    <li key={item.id}>
                      <strong>{item.name}</strong> · {formatEuros(item.priceCents)}
                      {item.priceOverrideCents !== null && (
                        <span className="muted"> (precio de catálogo {formatEuros(item.basePriceCents)})</span>
                      )}
                      {!item.productActive && <span className="alert"> Archivado: quítalo para poder publicar</span>}
                      {item.allergens.length > 0 && (
                        <div className="muted">{item.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}</div>
                      )}
                      {canEdit && (
                        <div className="inline-form">
                          <ActionForm
                            action={setItemPriceAction.bind(null, orgId, menuId, item.id)}
                            submitLabel="Fijar precio"
                            className="inline-form"
                          >
                            <label>
                              <span className="visually-hidden">Precio en esta carta para {item.name}</span>
                              <input
                                name="price"
                                inputMode="decimal"
                                placeholder="Precio de catálogo"
                                defaultValue={item.priceOverrideCents !== null ? centsToInput(item.priceOverrideCents) : ""}
                                size={10}
                              />
                            </label>
                          </ActionForm>
                          {ii > 0 && (
                            <ActionForm
                              action={moveItemAction.bind(null, orgId, menuId, item.id, "up")}
                              submitLabel={`Subir ${item.name}`}
                              className="inline-form"
                            />
                          )}
                          {ii < section.items.length - 1 && (
                            <ActionForm
                              action={moveItemAction.bind(null, orgId, menuId, item.id, "down")}
                              submitLabel={`Bajar ${item.name}`}
                              className="inline-form"
                            />
                          )}
                          <ActionForm
                            action={removeItemAction.bind(null, orgId, menuId, item.id)}
                            submitLabel={`Quitar ${item.name}`}
                            className="inline-form"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit &&
                (available.length === 0 ? (
                  <p className="muted">
                    No quedan productos disponibles para añadir. <Link href={`/app/${orgId}/products`}>Gestionar productos</Link>
                  </p>
                ) : (
                  <ActionForm
                    action={addItemAction.bind(null, orgId, menuId, section.id)}
                    submitLabel={`Añadir a ${section.name}`}
                    className="inline-form"
                  >
                    <label>
                      <span className="visually-hidden">Producto para {section.name}</span>
                      <select name="productId" required>
                        {available.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({formatEuros(p.priceCents)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span className="visually-hidden">Precio específico (opcional)</span>
                      <input name="price" inputMode="decimal" placeholder="Precio específico (opcional)" size={22} />
                    </label>
                  </ActionForm>
                ))}
            </div>
          );
        })}
        {canEdit && (
          <ActionForm action={addSectionAction.bind(null, orgId, menuId)} submitLabel="Añadir categoría" className="inline-form">
            <label>
              <span className="visually-hidden">Nombre de la nueva categoría</span>
              <input name="name" placeholder="Nueva categoría (p. ej. Entrantes)" required maxLength={120} />
            </label>
          </ActionForm>
        )}
      </section>

      <section>
        <h3>Versiones publicadas</h3>
        {versions.length === 0 ? (
          <p className="muted">Todavía no se ha publicado ninguna versión.</p>
        ) : (
          <ul className="cards">
            {versions.map((v) => (
              <li key={v.id}>
                Versión {v.versionNumber} · {dateFormat.format(v.publishedAt)}
                {v.publishedByName && <span className="muted"> · {v.publishedByName}</span>}
                {v.isCurrent ? (
                  <strong> · Activa</strong>
                ) : (
                  canPublish && (
                    <ActionForm
                      action={activateVersionAction.bind(null, orgId, menuId, v.id)}
                      submitLabel={`Activar versión ${v.versionNumber}`}
                      className="inline-form"
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section>
          <h3>Ajustes de la carta</h3>
          <ActionForm action={updateMenuAction.bind(null, orgId, menuId)} submitLabel="Guardar ajustes">
            <label>
              Nombre
              <input name="name" defaultValue={menu.name} required maxLength={120} />
            </label>
            <label>
              Identificador (URL)
              <input name="slug" defaultValue={menu.slug} required />
            </label>
            <label>
              Tema
              <select name="theme" defaultValue={menu.theme}>
                {MENU_THEMES.map((t) => (
                  <option key={t} value={t}>
                    {MENU_THEME_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </ActionForm>
          <details>
            <summary>Eliminar carta</summary>
            <p className="muted">Se eliminarán el borrador y todas sus versiones; la página pública dejará de existir.</p>
            <ActionForm
              action={deleteMenuAction.bind(null, orgId, menuId, menu.establishmentId)}
              submitLabel="Eliminar definitivamente"
              className="inline-form"
            />
          </details>
        </section>
      )}
    </>
  );
}
