import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicBookingForm } from "@/components/public-booking-form";
import { siteChrome } from "@/components/site/chrome";
import { SiteShell } from "@/components/site/site-shell";
import styles from "@/components/site/site.module.css";
import { bookableDateRange, getPublicBookingInfo, listPublicSlots } from "@/server/modules/public-booking/service";
import { isValidLocalDate } from "@/server/modules/schedules/time";
import { getPublicSite } from "@/server/modules/site/service";
import { publicBookingAction } from "./actions";

type Params = Promise<{ orgSlug: string; estSlug: string }>;
type Search = Promise<{ date?: string; party?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orgSlug, estSlug } = await params;
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  return { title: info ? `Reservar en ${info.establishmentName}` : "Reservas no disponibles" };
}

export default async function PublicBookingPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { orgSlug, estSlug } = await params;
  const sp = await searchParams;
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  if (!info) notFound();

  const range = bookableDateRange(info);
  const date = typeof sp.date === "string" && isValidLocalDate(sp.date) ? sp.date : null;
  const party = Number(typeof sp.party === "string" ? sp.party : NaN);
  const searched = date !== null && Number.isInteger(party);
  const { slots } = searched ? await listPublicSlots(info, date, party) : { slots: [] as string[] };
  const longDate = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const content = (
    <>
      <form method="get" className="form" aria-label="Buscar disponibilidad">
        <div className="inline-form">
          <label>
            Fecha
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
            Comensales
            <select name="party" defaultValue={Number.isInteger(party) ? party : Math.min(2, info.maxParty)}>
              {Array.from({ length: info.maxParty - info.minParty + 1 }, (_, i) => info.minParty + i).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit">Ver horas disponibles</button>
        <p className="muted">
          Online se admiten grupos de {info.minParty} a {info.maxParty} personas. Para grupos mayores, llama al
          restaurante.
        </p>
      </form>

      {searched && (
        <section>
          <h2>
            {longDate.format(new Date(`${date}T12:00:00Z`))} · {party} {party === 1 ? "persona" : "personas"}
          </h2>
          {slots.length === 0 ? (
            <p className="notice">No quedan horas disponibles online para ese día. Prueba otra fecha.</p>
          ) : (
            <PublicBookingForm action={publicBookingAction.bind(null, orgSlug, estSlug)}>
              <input type="hidden" name="idempotencyKey" value={randomUUID()} readOnly />
              <input type="hidden" name="date" value={date} readOnly />
              <input type="hidden" name="partySize" value={party} readOnly />
              <fieldset className="slots">
                <legend>Hora</legend>
                {slots.map((s) => (
                  <label key={s} className="slot">
                    <input type="radio" name="time" value={s} required />
                    {s}
                  </label>
                ))}
              </fieldset>
              <label>
                Nombre
                <input name="customerName" required maxLength={120} autoComplete="name" />
              </label>
              <div className="inline-form">
                <label>
                  Teléfono
                  <input name="customerPhone" type="tel" maxLength={40} autoComplete="tel" />
                </label>
                <label>
                  Correo
                  <input name="customerEmail" type="email" maxLength={254} autoComplete="email" />
                </label>
              </div>
              <p className="muted">Indica al menos un teléfono o un correo.</p>
              <label>
                Comentarios (opcional)
                <input name="notes" maxLength={300} placeholder="Alergias, trona, celebración…" />
              </label>
              {/* Campo trampa contra bots: oculto para personas y para lectores de pantalla. */}
              <div aria-hidden="true" className="hp">
                <label>
                  No rellenar
                  <input name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>
              <label className="inline-form">
                <input type="checkbox" name="consent" required />
                <span>
                  Acepto que {info.organizationName} trate estos datos únicamente para gestionar esta reserva y
                  contactarme sobre ella. Se conservan {info.customerRetentionDays} días después de la reserva y después
                  se anonimizan. Puedes pedir una copia o su borrado al restaurante.
                </span>
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
      <SiteShell current="booking" site={siteChrome(site, orgSlug, estSlug)}>
        <section className={styles.pageHead}>
          <p className={styles.eyebrow}>Reservas online</p>
          <h1 className={styles.heroTitle}>Reservar mesa</h1>
          <span className={styles.rule} aria-hidden="true" />
        </section>
        <div className={styles.pageBody}>{content}</div>
      </SiteShell>
    );
  }

  return (
    <main>
      <p className="muted">{info.organizationName}</p>
      <h1>Reservar en {info.establishmentName}</h1>
      {content}
    </main>
  );
}
