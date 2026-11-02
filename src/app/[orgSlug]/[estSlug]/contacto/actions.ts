"use server";

import { CONTACT_TEXTS, translateContactMessage } from "@/lib/contact-i18n";
import type { FormState } from "@/lib/form-state";
import { isLanguage, type PublicLanguage } from "@/lib/languages";
import { toFormState } from "@/server/actions/form-state";
import { formString } from "@/server/actions/run";
import { submitContactMessage } from "@/server/modules/contact/service";
import { getPublicSite } from "@/server/modules/site/service";
import { clientIdentifier } from "@/server/request-ip";

/** Respuesta del servidor en el idioma de la página (D-049). */
function translated(state: FormState, lang: PublicLanguage): FormState {
  if (lang === "es") return state;
  return {
    ...state,
    ...(state.error ? { error: translateContactMessage(state.error, lang) } : {}),
    ...(state.fieldErrors
      ? {
          fieldErrors: Object.fromEntries(
            Object.entries(state.fieldErrors).map(([k, v]) => [k, v.map((m) => translateContactMessage(m, lang))]),
          ),
        }
      : {}),
  };
}

/** Envío del formulario de contacto de la web pública (sin sesión). */
export async function contactAction(
  orgSlug: string,
  estSlug: string,
  requestedLang: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const site = await getPublicSite(orgSlug, estSlug);
  // El idioma llega del cliente: solo se usa si el local lo ofrece.
  const lang: PublicLanguage =
    site && isLanguage(requestedLang) && site.languages.includes(requestedLang) ? requestedLang : "es";
  if (!site) return translated({ error: "Este restaurante no recibe mensajes desde la web" }, lang);
  try {
    await submitContactMessage(
      site.establishmentId,
      {
        customerName: formString(fd, "customerName"),
        customerPhone: formString(fd, "customerPhone"),
        customerEmail: formString(fd, "customerEmail"),
        message: formString(fd, "message"),
        consent: fd.get("consent") === "on",
        website: formString(fd, "website"),
        idempotencyKey: formString(fd, "idempotencyKey"),
      },
      await clientIdentifier(),
    );
    return { ok: true, message: CONTACT_TEXTS[lang].sent };
  } catch (err) {
    return translated(toFormState(err), lang);
  }
}
