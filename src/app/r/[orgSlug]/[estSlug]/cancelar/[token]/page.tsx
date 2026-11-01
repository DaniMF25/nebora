import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicBookingForm } from "@/components/public-booking-form";
import { siteChrome } from "@/components/site/chrome";
import { SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { BOOKING_TEXTS } from "@/lib/booking-i18n";
import { resolvePublicLanguage, withLang } from "@/lib/languages";
import { getPublicBookingInfo, getPublicCancellation } from "@/server/modules/public-booking/service";
import { getPublicSite, localizePublicSite } from "@/server/modules/site/service";
import { cancelReservationAction } from "./actions";

type Params = Promise<{ orgSlug: string; estSlug: string; token: string }>;
type Search = Promise<{ lang?: string | string[] }>;

// El enlace es la credencial: no se indexa ni se envía como Referer a otras webs.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Cancelación de una reserva online por el cliente con su enlace (D-041). */
export default async function CancelReservationPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { orgSlug, estSlug, token } = await params;
  const reservation = await getPublicCancellation(orgSlug, estSlug, token);
  if (!reservation) notFound();
  const [info, site] = await Promise.all([getPublicBookingInfo(orgSlug, estSlug), getPublicSite(orgSlug, estSlug)]);
  const offered = info?.languages ?? site?.languages ?? [];
  const lang = resolvePublicLanguage((await searchParams).lang, (await headers()).get("accept-language"), offered);
  const t = BOOKING_TEXTS[lang];
  const bookingPath = `/r/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}`;
  const bookingHref = offered.length > 0 ? withLang(bookingPath, lang) : bookingPath;
  const when = new Intl.DateTimeFormat(t.locale, {
    timeZone: reservation.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(reservation.startsAt);
  const cancellable = ["pending", "confirmed"].includes(reservation.status) && reservation.startsAt > new Date();

  const content = (
    <>
      <p>{t.cancelSummary(reservation.code, t.people(reservation.partySize), when)}</p>
      {reservation.status === "cancelled" ? (
        <p className="notice">{t.alreadyCancelled}</p>
      ) : !cancellable ? (
        <p className="notice">{t.notCancellable}</p>
      ) : (
        <PublicBookingForm
          action={cancelReservationAction.bind(null, orgSlug, estSlug, token, lang)}
          texts={{
            submit: t.cancelButton,
            sending: t.sending,
            another: t.backToBooking,
            cancelLink: "",
            cancelNote: "",
          }}
          anotherHref={info ? bookingHref : site ? `/${orgSlug.toLowerCase()}/${estSlug.toLowerCase()}` : "/"}
        >
          <p className="muted">{t.cancelConfirm}</p>
        </PublicBookingForm>
      )}
    </>
  );

  if (site) {
    return (
      <SiteShell
        current="booking"
        site={siteChrome(localizePublicSite(site, lang), orgSlug, estSlug, undefined, {
          lang,
          selfPath: `${bookingPath}/cancelar/${token}`,
        })}
      >
        <section className={styles.pageHead}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1 className={styles.heroTitle}>{t.cancelTitle}</h1>
          <span className={styles.rule} aria-hidden="true" />
        </section>
        <div className={styles.pageBody}>{content}</div>
      </SiteShell>
    );
  }
  return (
    <main lang={lang}>
      <h1>{t.cancelTitle}</h1>
      {content}
    </main>
  );
}
