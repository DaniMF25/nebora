import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { MENU_THEMES, MENU_THEME_LABELS } from "@/lib/menu-snapshot";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { hasUnpublishedChanges, listMenus } from "@/server/modules/menus/menus";
import { withTenant } from "@/server/tenancy/context";
import { createMenuAction } from "../actions";

/** Cartas de un local. Los productos se toman del catálogo común. */
export default async function EstablishmentMenusPage({
  params,
}: {
  params: Promise<{ orgId: string; estId: string }>;
}) {
  const { orgId, estId } = await params;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: await getEstablishment(tx, ctx, estId),
      menus: await Promise.all(
        (await listMenus(tx, ctx, estId)).map(async (m) => ({
          ...m,
          outdated: await hasUnpublishedChanges(tx, ctx, m.id),
        })),
      ),
      canEditMenus: ctx.permissions.has("menus.edit"),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment: est, menus, canEditMenus } = data;

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${est.id}`}>← {est.name}</Link>
      </p>
      <h2>Cartas</h2>
      <section>
        {menus.length === 0 ? (
          <p className="muted">Este establecimiento aún no tiene cartas.</p>
        ) : (
          <ul className="cards">
            {menus.map((m) => (
              <li key={m.id}>
                <Link href={`/app/${orgId}/menus/${m.id}`}>
                  <strong>{m.name}</strong>
                </Link>{" "}
                <span className="muted">
                  · {m.publishedVersionNumber ? `publicada (v${m.publishedVersionNumber})` : "sin publicar"}
                  {m.outdated && " · cambios sin publicar"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEditMenus && (
          <details>
            <summary>Nueva carta</summary>
            <ActionForm action={createMenuAction.bind(null, orgId, est.id)} submitLabel="Crear carta">
              <label>
                Nombre de la carta
                <input name="name" required maxLength={120} placeholder="Carta principal" />
              </label>
              <label>
                Identificador de la carta (URL)
                <input name="slug" required placeholder="carta" />
              </label>
              <label>
                Tema
                <select name="theme" defaultValue="moderno">
                  {MENU_THEMES.map((t) => (
                    <option key={t} value={t}>
                      {MENU_THEME_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          </details>
        )}
        <p className="muted">
          Los platos salen del <Link href={`/app/${orgId}/products`}>catálogo de productos</Link>, común a todos los
          locales; en cada carta eliges cuáles se ofrecen aquí y, si quieres, con otro precio.
        </p>
      </section>
    </>
  );
}
