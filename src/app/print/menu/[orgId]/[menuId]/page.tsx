import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MenuPrint, type PrintOptions } from "@/components/print/menu-print";
import { PrintButton } from "@/components/print/print-button";
import { requireUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/config/env";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { buildSnapshot, getMenuSummary, getPublishedSnapshot } from "@/server/modules/menus/menus";
import { menuShortUrl, renderQrSvg } from "@/server/modules/menus/qr";
import { withTenant } from "@/server/tenancy/context";

export const metadata: Metadata = {
  title: "Imprimir carta",
  robots: { index: false, follow: false },
};

type Params = Promise<{ orgId: string; menuId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Carta lista para imprimir o guardar como PDF desde el navegador. Por defecto
 * la versión publicada (la misma que ve el cliente con el QR); también el
 * borrador. Solo miembros con permiso de lectura de cartas.
 */
export default async function PrintMenuPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgId, menuId } = await params;
  const search = await searchParams;
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      menu: await getMenuSummary(tx, ctx, menuId),
      published: await getPublishedSnapshot(tx, ctx, menuId),
      draft: await buildSnapshot(tx, ctx, menuId),
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { menu, published, draft } = data;

  // Sin enviar el formulario, todas las opciones activadas. Al enviarlo
  // (marca `o`), una casilla sin marcar no viaja y significa «no».
  const submitted = one(search.o) === "1";
  const flag = (name: string) => !submitted || one(search[name]) === "1";
  const options: PrintOptions = {
    descriptions: flag("desc"),
    allergens: flag("allergens"),
    columns: one(search.cols) === "2" ? 2 : 1,
  };
  const useDraft = !published || one(search.version) === "draft";
  const snapshot = useDraft ? draft : published.snapshot;
  const showQr = !useDraft && flag("qr");

  const baseUrl = getEnv().APP_BASE_URL;
  const qrDataUrl =
    showQr && baseUrl
      ? `data:image/svg+xml;base64,${Buffer.from(await renderQrSvg(menuShortUrl(baseUrl, menu.publicCode))).toString("base64")}`
      : null;
  const empty = snapshot.sections.every((s) => s.items.length === 0);

  return (
    <main className="print-screen">
      <div className="print-toolbar">
        <p>
          <Link href={`/app/${orgId}/menus/${menuId}?tab=publicacion`}>← Volver a la carta</Link>
        </p>
        <form method="get" className="print-options" aria-label="Opciones de impresión">
          <input type="hidden" name="o" value="1" />
          <fieldset>
            <legend>Versión</legend>
            {published ? (
              <>
                <label className="check">
                  <input type="radio" name="version" value="published" defaultChecked={!useDraft} />
                  Publicada (versión {published.versionNumber})
                </label>
                <label className="check">
                  <input type="radio" name="version" value="draft" defaultChecked={useDraft} />
                  Borrador actual
                </label>
              </>
            ) : (
              <p className="muted">La carta no está publicada: se imprime el borrador y sin QR.</p>
            )}
          </fieldset>
          <fieldset>
            <legend>Contenido</legend>
            <label className="check">
              <input type="checkbox" name="desc" value="1" defaultChecked={options.descriptions} />
              Descripciones
            </label>
            <label className="check">
              <input type="checkbox" name="allergens" value="1" defaultChecked={options.allergens} />
              Alérgenos
            </label>
            {published && (
              <label className="check">
                <input type="checkbox" name="qr" value="1" defaultChecked={flag("qr")} />
                QR de la carta online
              </label>
            )}
          </fieldset>
          <fieldset>
            <legend>Columnas</legend>
            <label className="check">
              <input type="radio" name="cols" value="1" defaultChecked={options.columns === 1} />
              Una
            </label>
            <label className="check">
              <input type="radio" name="cols" value="2" defaultChecked={options.columns === 2} />
              Dos
            </label>
          </fieldset>
          <div className="print-actions">
            <button type="submit" className="secondary">
              Aplicar
            </button>
            <PrintButton />
          </div>
        </form>
        {useDraft && published && (
          <p role="status" className="notice">
            Estás imprimiendo el borrador: puede no coincidir con la carta publicada.
          </p>
        )}
        {showQr && !baseUrl && (
          <p role="status" className="notice">
            QR no disponible: falta configurar APP_BASE_URL.
          </p>
        )}
      </div>
      {empty ? (
        <p className="notice">Esta versión de la carta no tiene platos.</p>
      ) : (
        <MenuPrint snapshot={snapshot} options={options} qrDataUrl={qrDataUrl} />
      )}
    </main>
  );
}
