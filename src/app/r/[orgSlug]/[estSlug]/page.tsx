import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicBookingForm } from "@/components/public-booking-form";
import { languageLinks, siteChrome } from "@/components/site/chrome";
import { SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { BOOKING_TEXTS } from "@/lib/booking-i18n";
import { LANGUAGE_NATIVE_NAMES, resolvePublicLanguage, withLang } from "@/lib/languages";
import { PUBLIC_TEXTS } from "@/lib/public-i18n";
import {
  bookableDateRange,
  getPublicBookingInfo,
  listPublicSlots,
  type PublicBookingInfo,
} from "@/server/modules/public-booking/service";
import { isValidLocalDate } from "@/server/modules/schedules/time";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { publicBookingAction } from "./actions";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ date?: string; party?: string; lang?: string | string[] }>;

/** Idioma de la página: `?lang=`, el del navegador si el local lo ofrece, o español (D-040). */
async function pageLanguage(info: PublicBookingInfo, search: Search) {
  return resolvePublicLanguage((await search).lang, (await headers()).get("accept-language"), info.languages);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  if (!info) return { title: "Reservas no disponibles" };
  return { title: BOOKING_TEXTS[await pageLanguage(info, searchParams)].pageTitle(info.establishmentName) };
}

export default async function PublicBookingPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug } = await params;
  const sp = await searchParams;
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  if (!info) notFound();
  const lang = await pageLanguage(info, searchParams);
  const t = BOOKING_TEXTS[lang];
  const multilingual = info.languages.length > 0;
  const selfPath = `/r/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}`;

  const range = bookableDateRange(info);
  const date = typeof sp.date === "string" && isValidLocalDate(sp.date) ? sp.date : null;
  const party = Number(typeof sp.party === "string" ? sp.party : NaN);
  const searched = date !== null && Number.isInteger(party);
  const { slots } = searched ? await listPublicSlots(info, date, party) : { slots: [] as string[] };
  const longDate = new Intl.DateTimeFormat(t.locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const content = (
    <>
      <form method="get" className="form" aria-label={t.searchLabel}>
        {/* Al buscar se conserva el idioma elegido. */}
        {multilingual && <input type="hidden" name="lang" value={lang} />}
        <div className="inline-form">
          <label>
            {t.date}
            <input
              type="date"
              name="date"
              required
              min={range.first}
              max={range.last}
              defaultValue={date ?? range.first}
            />
          </label>
          <label>
            {t.party}
            <select name="party" defaultValue={Number.isInteger(party) ? party : Math.min(2, info.maxParty)}>
              {Array.from({ length: info.maxParty - info.minParty + 1 }, (_, i) => info.minParty + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit">{t.seeTimes}</button>
        <p className="muted">{t.groupsNote(info.minParty, info.maxParty)}</p>
      </form>

      {searched && (
        <section>
          <h2>
            {longDate.format(new Date(`${date}T12:00:00Z`))} · {t.people(party)}
          </h2>
          {slots.length === 0 ? (
            <p className="notice">{t.noSlots}</p>
          ) : (
            <PublicBookingForm
              action={publicBookingAction.bind(null, orgSlug, estSlug, lang)}
              texts={{
                submit: t.submit,
                sending: t.sending,
                another: t.another,
                cancelLink: t.cancelLink,
                cancelNote: t.cancelNote,
              }}
              anotherHref={multilingual ? withLang(selfPath, lang) : selfPath}
            >
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <input type="hidden" name="date" value={date} readOnly />
              <input type="hidden" name="partySize" value={party} readOnly />
              <fieldset className="slots">
                <legend>{t.time}</legend>
                {slots.map((s) => (
                  <label key={s} className="slot">
                    <input type="radio" name="time" value={s} required />
                    {s}
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
                {t.notes}
                <input name="notes" maxLength={300} placeholder={t.notesPlaceholder} />
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
                <span>{t.consent(info.organizationName, info.customerRetentionDays)}</span>
              </label>
            </PublicBookingForm>
          )}
        </section>
      )}
    </>
  );

  // Con la web del local publicada, la reserva se integra en ella.
  const site = await getPublicSite(orgSlug, estSlug);
  if (site) {
    return (
      <SiteShell
        current="booking"
        site={siteChrome(localizePublicSite(site, lang), orgSlug, estSlug, undefined, { lang, selfPath })}
      >
        <section className={styles.pageHead}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1 className={styles.heroTitle}>{PUBLIC_TEXTS[lang].bookTable}</h1>
          <span className={styles.rule} aria-hidden="true" />
        </section>
        <div className={styles.pageBody}>{content}</div>
      </SiteShell>
    );
  }

  return (
    <main lang={lang}>
      {multilingual && (
        <nav className="inline-form" aria-label={PUBLIC_TEXTS[lang].language}>
          {languageLinks(info.languages, selfPath).map((l) => (
            <a
              key={l.lang}
              href={l.href}
              hrefLang={l.lang}
              lang={l.lang}
              aria-current={l.lang === lang ? "true" : undefined}
            >
              {LANGUAGE_NATIVE_NAMES[l.lang]}
            </a>
          ))}
        </nav>
      )}
      <p className="muted">{info.organizationName}</p>
      <h1>{t.pageTitle(info.establishmentName)}</h1>
      {content}
    </main>
  );
}
