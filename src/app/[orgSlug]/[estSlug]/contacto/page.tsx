import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicBookingForm } from "@/components/public-booking-form";
import { siteChrome } from "@/components/site/chrome";
import { Icon } from "@/components/site/icons";
import { mapsUrl, SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { CONTACT_TEXTS } from "@/lib/contact-i18n";
import { resolvePublicLanguage, withLang } from "@/lib/languages";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import { CONTACT_TOPICS, MAX_MESSAGE_LENGTH, publicRetentionDays } from "@/server/modules/contact/service";
import { formatMinutes, isoWeekday, localDateOf } from "@/server/modules/schedules/time";
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

  const pt = PUBLIC_TEXTS[lang];
  // Horario día a día, con el de hoy (en la hora del local) resaltado.
  const todayWeekday = isoWeekday(localDateOf(new Date(), site.timezone));
  const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    label: pt.shortDays[weekday - 1]!,
    slots: site.openingHours
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => a.opensMinute - b.opensMinute)
      .map((h) => `${formatMinutes(h.opensMinute)} – ${formatMinutes((h.opensMinute + h.durationMinutes) % 1440)}`),
  }));
  const ways = [
    ...(site.phone
      ? [
          {
            icon: "phone" as const,
            label: pt.callUs,
            value: site.phone,
            href: `tel:${site.phone.replace(/[^0-9+]/g, "")}`,
          },
        ]
      : []),
    ...(site.whatsapp
      ? [
          {
            icon: "whatsapp" as const,
            label: "WhatsApp",
            value: pt.writeUs,
            href: `https://wa.me/${site.whatsapp}`,
            external: true,
          },
        ]
      : []),
    ...(site.address
      ? [
          {
            icon: "pin" as const,
            label: pt.directions,
            value: site.address,
            href: mapsUrl(site.address),
            external: true,
          },
        ]
      : []),
    ...(site.instagram
      ? [
          {
            icon: "instagram" as const,
            label: pt.followUs,
            value: `@${site.instagram}`,
            href: `https://www.instagram.com/${site.instagram}/`,
            external: true,
          },
        ]
      : []),
  ];

  return (
    <SiteShell current="contact" site={chrome}>
      <section className={styles.pageHead}>
        <p className={styles.eyebrow}>{site.establishmentName}</p>
        <h1 className={styles.heroTitle}>{pt.contact}</h1>
        <span className={styles.rule} aria-hidden="true" />
      </section>
      {/* Rediseño (D-052): fichas de contacto y horario a un lado, formulario al otro, en los colores claros del estilo. */}
      <div className={styles.contactLayout}>
        <div className={styles.contactSide}>
          <p className={styles.contactIntro}>{t.intro}</p>
          {ways.length > 0 && (
            <section aria-labelledby="contacto-directo">
              <h2 id="contacto-directo" className={styles.contactHeading}>
                {t.waysTitle}
              </h2>
              <ul className={styles.contactWays}>
                {ways.map((w) => (
                  <li key={w.icon}>
                    <a
                      href={w.href}
                      className={styles.contactWay}
                      {...("external" in w && w.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      <span className={styles.contactWayIcon} aria-hidden="true">
                        <Icon name={w.icon} />
                      </span>
                      <span>
                        <strong>{w.label}</strong>
                        <span className={styles.contactWayValue}>{w.value}</span>
                      </span>
                      <Icon name="arrow" className={styles.contactWayArrow} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="contacto-horario" className={styles.contactHours}>
            <h2 id="contacto-horario" className={styles.contactHeading}>
              {pt.hours}
            </h2>
            {site.openingHours.length === 0 ? (
              <p>{pt.askAvailability}</p>
            ) : (
              <dl>
                {days.map((d) => (
                  <div key={d.weekday} className={d.weekday === todayWeekday ? styles.contactToday : undefined}>
                    <dt>
                      {d.label}
                      {d.weekday === todayWeekday && <span className={styles.contactTodayBadge}>{t.today}</span>}
                    </dt>
                    <dd>{d.slots.length > 0 ? d.slots.join(" · ") : t.closed}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        {data.form && (
          <section aria-labelledby="formulario-contacto" className={styles.contactFormCard}>
            <h2 id="formulario-contacto" className={styles.blockTitle}>
              {t.formTitle}
            </h2>
            <PublicBookingForm
              action={contactAction.bind(null, orgSlug, estSlug, lang)}
              texts={{ submit: t.submit, sending: t.sending, another: t.another, cancelLink: "", cancelNote: "" }}
              anotherHref={multilingual ? withLang(selfPath, lang) : selfPath}
            >
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <fieldset className={styles.contactTopics}>
                <legend>{t.topicLegend}</legend>
                {CONTACT_TOPICS.map((topic) => (
                  <label key={topic} className={styles.contactTopic}>
                    <input type="radio" name="topic" value={topic} />
                    <span>{t.topics[topic]}</span>
                  </label>
                ))}
              </fieldset>
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
