import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { MENU_THEMES, MENU_THEME_LABELS } from "@/lib/menu-snapshot";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { getEnv } from "@/server/config/env";
import { describeAvailability } from "@/server/modules/menus/availability";
import { hasUnpublishedChanges, listMenus } from "@/server/modules/menus/menus";
import { getOrganization } from "@/server/modules/organizations/service";
import { listProducts } from "@/server/modules/menus/products";
import { listSpecials, MAX_SPECIALS, type Special, type SpecialStatus } from "@/server/modules/menus/specials";
import { formatEuros } from "@/lib/money";
import { addSpecialAction, removeSpecialAction } from "./actions";
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
      organization: await getOrganization(tx, ctx),
      menus: await Promise.all(
        (await listMenus(tx, ctx, estId)).map(async (m) => ({
          ...m,
          outdated: await hasUnpublishedChanges(tx, ctx, m.id),
        })),
      ),
      canEditMenus: ctx.permissions.has("menus.edit"),
      specials: await listSpecials(tx, ctx, estId),
      // Solo platos activos disponibles en este local (D-032).
      products: await listProducts(tx, ctx, { activeOnly: true, availableIn: estId }),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment: est, organization, menus, canEditMenus, specials, products } = data;
  const offered = new Set(specials.map((s) => s.productId));
  // Enlace único a la carta que se sirve en cada momento (D-036).
  const currentMenuPath = `/m/${organization.slug}/${est.slug}`;
  const base = getEnv().APP_BASE_URL;
  const published = menus.filter((m) => m.publishedVersionNumber);

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
                <div className="muted">
                  Se sirve: {m.availability ? describeAvailability(m.availability) : "siempre"}
                </div>
              </li>
            ))}
          </ul>
        )}
        {published.length > 1 && (
          <p className="muted">
            Carta del momento:{" "}
            <a href={currentMenuPath} target="_blank" rel="noreferrer">
              {base ? `${base}${currentMenuPath}` : currentMenuPath}
            </a>
            . Lleva siempre a la carta que se sirve ahora según los horarios; útil para un único QR en las mesas.
          </p>
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
      <section>
        <h3>Fuera de carta</h3>
        <p className="muted">
          Platos que ofreces aparte (sugerencias, producto del día…). Salen al momento como primera sección de las
          cartas de este local y de su web, sin volver a publicar. Se toman del catálogo, con sus alérgenos, foto y
          traducciones; el precio especial es opcional.
        </p>
        {specials.length === 0 ? (
          <p className="muted">No hay platos fuera de carta.</p>
        ) : (
          <ul className="cards">
            {specials.map((s) => (
              <li key={s.id}>
                <strong>{s.productName}</strong> · {formatEuros(s.priceCents)}
                {s.priceOverrideCents !== null && <span className="muted"> (precio especial)</span>}{" "}
                <span className={`badge ${s.status === "visible" ? "badge-ok" : s.status === "scheduled" ? "badge-warn" : ""}`}>
                  {STATUS_LABELS[s.status]}
                </span>
                <div className="muted">{validity(s)}</div>
                {canEditMenus && (
                  <ActionForm
                    action={removeSpecialAction.bind(null, orgId, est.id, s.id)}
                    submitLabel={`Quitar ${s.productName} de fuera de carta`}
                    className="inline-form"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditMenus && specials.length < MAX_SPECIALS && (
          <details>
            <summary>Añadir plato fuera de carta</summary>
            <ActionForm action={addSpecialAction.bind(null, orgId, est.id)} submitLabel="Añadir fuera de carta">
              <label>
                Plato
                <select name="productId" required defaultValue="">
                  <option value="" disabled>
                    Elige un plato del catálogo
                  </option>
                  {products
                    .filter((p) => !offered.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatEuros(p.priceCents)})
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Precio especial (€, opcional)
                <input name="price" inputMode="decimal" placeholder="Vacío = precio del catálogo" />
              </label>
              <label className="check">
                <input type="checkbox" name="today" /> Solo hoy
              </label>
              <div className="inline-form">
                <label>
                  Desde (opcional)
                  <input type="date" name="startsOn" />
                </label>
                <label>
                  Hasta (opcional)
                  <input type="date" name="endsOn" />
                </label>
              </div>
              <p className="muted">Sin fechas, se muestra hasta que lo quites.</p>
            </ActionForm>
            {products.length === 0 && (
              <p className="muted">
                No hay productos disponibles en este local. <Link href={`/app/${orgId}/products`}>Crea uno en el catálogo</Link>.
              </p>
            )}
          </details>
        )}
      </section>
    </>
  );
}

const STATUS_LABELS: Record<SpecialStatus, string> = {
  visible: "Visible hoy",
  scheduled: "Programado",
  expired: "Caducado",
  archived: "Producto archivado",
  unavailable: "No disponible en este local",
};

const dateLabel = (d: string) => d.split("-").reverse().join("/");

/** Vigencia en palabras: «Solo el 31/10/2026», «Del … al …», «Hasta que lo quites»… */
function validity(s: Special): string {
  if (s.startsOn && s.endsOn) {
    return s.startsOn === s.endsOn
      ? `Solo el ${dateLabel(s.startsOn)}`
      : `Del ${dateLabel(s.startsOn)} al ${dateLabel(s.endsOn)}`;
  }
  if (s.startsOn) return `Desde el ${dateLabel(s.startsOn)}, hasta que lo quites`;
  if (s.endsOn) return `Hasta el ${dateLabel(s.endsOn)}`;
  return "Hasta que lo quites";
}
