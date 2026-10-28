import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageTabs, pickTab } from "@/components/panel/page-tabs";
import { ThemePicker } from "@/components/panel/theme-picker";
import { HIGHLIGHT_ICON_LABELS, HIGHLIGHT_ICONS, MAX_HIGHLIGHTS, privateMediaUrl } from "@/lib/site";
import { requireUser } from "@/server/auth/current-user";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { listMenus } from "@/server/modules/menus/menus";
import { getOrganization } from "@/server/modules/organizations/service";
import { getSiteProfile } from "@/server/modules/site/service";
import { withTenant } from "@/server/tenancy/context";
import { TranslationInput, TranslationStatusBadge } from "@/components/panel/translation-field";
import { LANGUAGE_LABELS } from "@/lib/languages";
import { getSiteTranslationForm } from "@/server/modules/translations/service";
import { BrandSettings } from "@/components/panel/brand-settings";
import {
  removeHeroImageAction,
  removeLogoAction,
  setBrandingAction,
  setLogoAction,
  saveSiteTranslationsAction,
  setHeroImageAction,
  setThemeAction,
  updateSiteAction,
} from "./actions";

const TABS = ["estilo", "marca", "contenido", "foto", "traducciones"] as const;

export default async function SiteProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string; estId: string }>;
  searchParams: Promise<{ tab?: string; lang?: string }>;
}) {
  const { orgId, estId } = await params;
  const search = await searchParams;
  const tab = pickTab(search.tab, TABS);
  const user = await requireUser();
  let data;
  try {
    data = await withTenant(user, orgId, async (tx, ctx) => ({
      establishment: await getEstablishment(tx, ctx, estId),
      orgSlug: (await getOrganization(tx, ctx)).slug,
      profile: await getSiteProfile(tx, ctx, estId),
      menus: ctx.permissions.has("menus.read") ? await listMenus(tx, ctx, estId) : [],
      canEdit: ctx.permissions.has("establishments.update"),
      translations: tab === "traducciones" ? await getSiteTranslationForm(tx, ctx, estId, search.lang) : null,
    }));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
  const { establishment: est, profile: p, menus, canEdit, orgSlug, translations: tr } = data;
  const TAB_LIST = [
    { id: "estilo", label: "Estilo" },
    { id: "marca", label: "Marca" },
    { id: "contenido", label: "Contenido" },
    { id: "foto", label: "Foto principal" },
    ...(est.languages.length > 0 ? [{ id: "traducciones", label: "Traducciones" }] : []),
  ];
  const slots = Array.from({ length: MAX_HIGHLIGHTS }, (_, n) => p.highlights[n]);

  return (
    <>
      <p>
        <Link href={`/app/${orgId}/establishments/${est.id}`}>← {est.name}</Link>
      </p>
      <div className="page-head">
        <div>
          <h2>Diseño de tu web</h2>
          <p className="muted">
            Lo que ven tus clientes: presentación, carta destacada, horario y contacto. El horario y la dirección se
            toman de la ficha del local.
          </p>
        </div>
        <div className="info-box">
          <p>
            Estado: <strong>{p.published ? "publicada" : "sin publicar"}</strong>
            {p.published && (
              <>
                {" · "}
                <a href={`/${orgSlug}/${est.slug}`} target="_blank" rel="noopener">
                  Ver página pública
                </a>
              </>
            )}
          </p>
          <p className="muted">Puedes cambiar de estilo cuando quieras: tu contenido se mantiene.</p>
        </div>
      </div>

      <PageTabs tabs={TAB_LIST} current={tab} basePath={`/app/${orgId}/establishments/${est.id}/site`} />

      {tab === "estilo" && (
        <section className="bare" aria-labelledby="estilos">
          <h3 id="estilos" className="visually-hidden">
            Estilo
          </h3>
          <ThemePicker
            current={p.theme}
            brand={est.name}
            tagline={p.tagline}
            title={p.heroTitle ?? est.name}
            heroImageUrl={p.heroMediaId ? privateMediaUrl(orgId, p.heroMediaId) : null}
            previewHref={(theme) => `/preview/site/${orgId}/${est.id}?theme=${theme}`}
            choose={canEdit ? (theme) => setThemeAction.bind(null, orgId, est.id, theme) : undefined}
          />
        </section>
      )}

      {tab === "marca" && (
        <BrandSettings
          theme={p.theme}
          establishmentName={est.name}
          logoUrl={p.logoMediaId ? privateMediaUrl(orgId, p.logoMediaId) : null}
          accentColor={p.accentColor}
          fontPairing={p.fontPairing}
          previewHref={(font) =>
            `/preview/site/${orgId}/${est.id}?theme=${p.theme}${font ? `&font=${encodeURIComponent(font)}` : ""}`
          }
          canEdit={canEdit}
          setLogo={setLogoAction.bind(null, orgId, est.id)}
          removeLogo={removeLogoAction.bind(null, orgId, est.id)}
          setBranding={setBrandingAction.bind(null, orgId, est.id)}
        />
      )}

      {tab === "contenido" && (
        <section>
          <h3>Contenido</h3>
          {!canEdit ? (
            <p className="muted">No tienes permiso para editar la página de este local.</p>
          ) : (
            <ActionForm action={updateSiteAction.bind(null, orgId, est.id)} submitLabel="Guardar página">
              <fieldset className="form">
                <input type="hidden" name="theme" value={p.theme} readOnly />
                <label>
                  Eslogan (junto al nombre)
                  <input
                    name="tagline"
                    maxLength={60}
                    defaultValue={p.tagline ?? ""}
                    placeholder="Cocina sin límites"
                  />
                </label>
                <label>
                  Antetítulo
                  <input
                    name="heroEyebrow"
                    maxLength={60}
                    defaultValue={p.heroEyebrow ?? ""}
                    placeholder="Bienvenidos"
                  />
                </label>
                <label>
                  Titular (obligatorio para publicar)
                  <input
                    name="heroTitle"
                    maxLength={120}
                    defaultValue={p.heroTitle ?? ""}
                    placeholder="Sabores que te llevan al mar"
                  />
                </label>
                <label>
                  Texto de bienvenida
                  <textarea name="heroText" maxLength={400} rows={3} defaultValue={p.heroText ?? ""} />
                </label>
                <label>
                  Carta destacada
                  <select name="featuredMenuId" defaultValue={p.featuredMenuId ?? ""}>
                    <option value="">Ninguna</option>
                    {menus.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.publishedVersionNumber ? "" : " (sin publicar: no se mostrará)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Teléfono
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    defaultValue={p.phone ?? ""}
                    placeholder="+34 912 345 678"
                  />
                </label>
                <label>
                  WhatsApp (con prefijo internacional)
                  <input
                    name="whatsapp"
                    type="tel"
                    maxLength={20}
                    defaultValue={p.whatsapp ? `+${p.whatsapp}` : ""}
                    placeholder="+34 600 112 233"
                  />
                </label>
                <label>
                  Instagram
                  <input
                    name="instagram"
                    maxLength={60}
                    defaultValue={p.instagram ? `@${p.instagram}` : ""}
                    placeholder="@turestaurante"
                  />
                </label>
                {slots.map((h, n) => (
                  <fieldset key={n} className="highlight">
                    <legend>Destacado {n + 1} (opcional)</legend>
                    <label>
                      Icono
                      <select name={`h${n}icon`} defaultValue={h?.icon ?? HIGHLIGHT_ICONS[n]}>
                        {HIGHLIGHT_ICONS.map((i) => (
                          <option key={i} value={i}>
                            {HIGHLIGHT_ICON_LABELS[i]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Título
                      <input name={`h${n}title`} maxLength={40} defaultValue={h?.title ?? ""} />
                    </label>
                    <label>
                      Texto
                      <input name={`h${n}text`} maxLength={120} defaultValue={h?.text ?? ""} />
                    </label>
                  </fieldset>
                ))}
                <label className="checkbox">
                  <span>
                    <input type="checkbox" name="published" defaultChecked={p.published} /> Publicar la página
                  </span>
                </label>
              </fieldset>
            </ActionForm>
          )}
        </section>
      )}

      {tab === "foto" && (
        <section>
          <h3>Foto principal</h3>
          {p.heroMediaId ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por ruta autenticada
            <img src={privateMediaUrl(orgId, p.heroMediaId)} alt="Foto principal" className="media-thumb media-hero" />
          ) : (
            <p className="muted">Sin foto. Se usará un fondo del tema.</p>
          )}
          {canEdit && (
            <>
              <ActionForm action={setHeroImageAction.bind(null, orgId, est.id)} submitLabel="Subir foto principal">
                <label>
                  Imagen horizontal (JPEG, PNG o WebP, hasta 8 MB)
                  <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
                </label>
              </ActionForm>
              {p.heroMediaId && (
                <ActionForm
                  action={removeHeroImageAction.bind(null, orgId, est.id)}
                  submitLabel="Quitar foto principal"
                  className="inline-form"
                />
              )}
            </>
          )}
        </section>
      )}
      {tab === "traducciones" && (
        <section>
          <h3>Traducciones</h3>
          {!tr ? (
            <p className="muted">
              Este local no tiene idiomas adicionales. Actívalos en{" "}
              <Link href={`/app/${orgId}/establishments/${est.id}?tab=datos`}>Datos del local</Link>.
            </p>
          ) : (
            <>
              <nav className="lang-tabs" aria-label="Idioma de la traducción">
                {tr.languages.map((l) => (
                  <Link
                    key={l}
                    href={`/app/${orgId}/establishments/${est.id}/site?tab=traducciones&lang=${l}`}
                    aria-current={l === tr.lang ? "page" : undefined}
                  >
                    {LANGUAGE_LABELS[l]}
                  </Link>
                ))}
              </nav>
              <p>
                <TranslationStatusBadge status={tr.status} />{" "}
                <span className="muted">
                  Los cambios se ven en la web en cuanto se guardan. Lo que no esté traducido se muestra en español.
                </span>
              </p>
              <ActionForm
                action={saveSiteTranslationsAction.bind(null, orgId, est.id, tr.lang)}
                submitLabel={`Guardar traducción (${LANGUAGE_LABELS[tr.lang].toLowerCase()})`}
              >
                <div className="translation-list">
                  <div className="translation-item">
                    <TranslationInput
                      name="tagline"
                      label="Eslogan"
                      source={tr.source.tagline}
                      value={tr.value.tagline}
                      max={60}
                      readOnly={!canEdit}
                    />
                    <TranslationInput
                      name="heroEyebrow"
                      label="Antetítulo"
                      source={tr.source.heroEyebrow}
                      value={tr.value.heroEyebrow}
                      max={60}
                      readOnly={!canEdit}
                    />
                    <TranslationInput
                      name="heroTitle"
                      label="Titular"
                      source={tr.source.heroTitle}
                      value={tr.value.heroTitle}
                      max={120}
                      readOnly={!canEdit}
                    />
                    <TranslationInput
                      name="heroText"
                      label="Texto de bienvenida"
                      source={tr.source.heroText}
                      value={tr.value.heroText}
                      max={400}
                      multiline
                      readOnly={!canEdit}
                    />
                  </div>
                  {tr.source.highlights.map((h, n) => (
                    <div key={n} className="translation-item">
                      <header>
                        <strong>Destacado {n + 1}</strong>
                      </header>
                      <TranslationInput
                        name={`h${n}title`}
                        label={`Título del destacado ${n + 1}`}
                        source={h.title}
                        value={tr.value.highlights[n]?.title ?? ""}
                        max={40}
                        readOnly={!canEdit}
                      />
                      <TranslationInput
                        name={`h${n}text`}
                        label={`Texto del destacado ${n + 1}`}
                        source={h.text}
                        value={tr.value.highlights[n]?.text ?? ""}
                        max={120}
                        readOnly={!canEdit}
                      />
                    </div>
                  ))}
                </div>
              </ActionForm>
            </>
          )}
        </section>
      )}
    </>
  );
}
