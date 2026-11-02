import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicBookingForm } from "@/components/public-booking-form";
import { siteChrome } from "@/components/site/chrome";
import { ContactDetails, SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { CONTACT_TEXTS } from "@/lib/contact-i18n";
import { resolvePublicLanguage, withLang } from "@/lib/languages";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { MAX_MESSAGE_LENGTH, publicRetentionDays } from "@/server/modules/contact/service";
import { publicEstablishmentPlan } from "@/server/modules/site/plan-look";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { planIncludes } from "@/server/tenancy/permissions";
import { contactAction } from "./actions";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ lang?: string | string[] }>;

// Página de contacto de la web (D-049): los datos del local en todos los
// planes y, desde el plan Avanzado, un formulario cuyos mensajes llegan al panel.
const load = cache(async (org: string, est: string) => {
  const site = await getPublicSite(org, est);
  if (!site) return null;
  const plan = await publicEstablishmentPlan(site.establishmentId);
  return {
    site,
    form: planIncludes(plan, "advanced"),
    retentionDays: await publicRetentionDays(site.establishmentId),
  };
});

async function pageLanguage(search: Search, offered: readonly string[]) {
  return resolvePublicLanguage((await search).lang, (await headers()).get("accept-language"), offered);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) return { title: "Página no encontrada" };
  const lang = await pageLanguage(searchParams, data.site.languages);
  return { title: CONTACT_TEXTS[lang].pageTitle(localizePublicSite(data.site, lang).establishmentName) };
}

export default async function ContactPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug } = await params;
  const data = await load(orgSlug, estSlug);
  if (!data) notFound();
  const lang = await pageLanguage(searchParams, data.site.languages);
  const site = localizePublicSite(data.site, lang);
  const selfPath = `/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}/contacto`;
  const chrome = siteChrome(site, orgSlug, estSlug, undefined, { lang, selfPath });
  const t = CONTACT_TEXTS[lang];
  const multilingual = site.languages.length > 0;

  return (
    <SiteShell current="contact" site={chrome}>
      <section className={styles.pageHead}>
        <p className={styles.eyebrow}>{site.establishmentName}</p>
        <h1 className={styles.heroTitle}>{PUBLIC_TEXTS[lang].contact}</h1>
        <span className={styles.rule} aria-hidden="true" />
      </section>
      <div className={styles.pageBody}>
        <p>{t.intro}</p>
        {/* Con los colores del pie (pensados para su fondo), en un panel. */}
        <div className={`${styles.contact} ${styles.contactPanel}`}>
          <ContactDetails site={chrome} />
        </div>
        {data.form && (
          <section aria-labelledby="formulario-contacto">
            <h2 id="formulario-contacto">{t.formTitle}</h2>
            <PublicBookingForm
              action={contactAction.bind(null, orgSlug, estSlug, lang)}
              texts={{ submit: t.submit, sending: t.sending, another: t.another, cancelLink: "", cancelNote: "" }}
              anotherHref={multilingual ? withLang(selfPath, lang) : selfPath}
            >
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <label>
                {t.name}
                <input name="customerName" required maxLength={120} autoComplete="name" />
              </label>
              <div className="inline-form">
                <label>
                  {t.phone}
                  <input name="customerPhone" type="tel" maxLength={40} autoComplete="tel" />
                </label>
                <label>
                  {t.email}
                  <input name="customerEmail" type="email" maxLength={254} autoComplete="email" />
                </label>
              </div>
              <p className="muted">{t.contactNote}</p>
              <label>
                {t.message}
                <textarea
                  name="message"
                  required
                  rows={5}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder={t.messagePlaceholder}
                />
              </label>
              {/* Campo trampa contra bots: oculto para personas y para lectores de pantalla. */}
              <div aria-hidden="true" className="hp">
                <label>
                  No rellenar
                  <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" name="consent" required />
                <span>{t.consent(site.organizationName, data.retentionDays)}</span>
              </label>
            </PublicBookingForm>
          </section>
        )}
      </div>
    </SiteShell>
  );
}
