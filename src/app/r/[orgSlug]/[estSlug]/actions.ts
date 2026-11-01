"use server";

import { BOOKING_TEXTS, translateBookingMessage } from "@/lib/booking-i18n";
import type { FormState } from "@/lib/form-state";
import { isLanguage, type PublicLanguage } from "@/lib/languages";
import { formString } from "@/server/actions/run";
import { toFormState } from "@/server/actions/form-state";
import { bookPublic, getPublicBookingInfo } from "@/server/modules/public-booking/service";
import { clientIdentifier } from "@/server/request-ip";

/** Respuesta del servidor en el idioma de la página (D-040). */
function translated(state: FormState, lang: PublicLanguage): FormState {
  if (lang === "es") return state;
  return {
    ...state,
    ...(state.error ? { error: translateBookingMessage(state.error, lang) } : {}),
    ...(state.fieldErrors
      ? {
          fieldErrors: Object.fromEntries(
            Object.entries(state.fieldErrors).map(([k, v]) => [k, v.map((m) => translateBookingMessage(m, lang))]),
          ),
        }
      : {}),
  };
}

export async function publicBookingAction(
  orgSlug: string,
  estSlug: string,
  requestedLang: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  // El idioma llega del cliente: solo se usa si el local lo ofrece.
  const lang: PublicLanguage =
    info && isLanguage(requestedLang) && info.languages.includes(requestedLang) ? requestedLang : "es";
  const t = BOOKING_TEXTS[lang];
  if (!info) return translated({ error: "Este establecimiento no acepta reservas online" }, lang);
  try {
    const result = await bookPublic(
      info,
      {
        date: formString(fd, "date"),
        time: formString(fd, "time"),
        partySize: Number(formString(fd, "partySize")),
        customerName: formString(fd, "customerName"),
        customerPhone: formString(fd, "customerPhone"),
        customerEmail: formString(fd, "customerEmail"),
        notes: formString(fd, "notes"),
        consent: fd.get("consent") === "on",
        website: formString(fd, "website"),
        idempotencyKey: formString(fd, "idempotencyKey"),
      },
      await clientIdentifier(),
    );
    const when = new Intl.DateTimeFormat(t.locale, {
      timeZone: info.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(result.startsAt);
    const head = result.status === "confirmed" ? t.confirmed : t.pending;
    return { ok: true, message: `${head} ${t.summary(t.people(result.partySize), when, result.code)}` };
  } catch (err) {
    return translated(toFormState(err), lang);
  }
}
