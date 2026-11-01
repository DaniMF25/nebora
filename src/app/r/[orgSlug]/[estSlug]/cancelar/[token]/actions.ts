"use server";

import { BOOKING_TEXTS } from "@/lib/booking-i18n";
import type { FormState } from "@/lib/form-state";
import { isLanguage, type PublicLanguage } from "@/lib/languages";
import { cancelPublicReservation } from "@/server/modules/public-booking/service";

/** Cancela la reserva del enlace (D-041). El token es la única credencial. */
export async function cancelReservationAction(
  orgSlug: string,
  estSlug: string,
  token: string,
  requestedLang: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  // Solo cambia los textos de la respuesta; cualquier idioma conocido vale.
  const lang: PublicLanguage = requestedLang === "es" || isLanguage(requestedLang) ? requestedLang : "es";
  const t = BOOKING_TEXTS[lang];
  const outcome = await cancelPublicReservation(orgSlug, estSlug, token);
  switch (outcome) {
    case "cancelled":
      return { ok: true, message: t.cancelled };
    case "already_cancelled":
      return { ok: true, message: t.alreadyCancelled };
    default:
      return { error: t.notCancellable };
  }
}
