"use server";

import type { FormState } from "@/lib/form-state";
import { formString } from "@/server/actions/run";
import { toFormState } from "@/server/actions/form-state";
import { bookPublic, getPublicBookingInfo } from "@/server/modules/public-booking/service";
import { clientIdentifier } from "@/server/request-ip";

export async function publicBookingAction(
  orgSlug: string,
  estSlug: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const info = await getPublicBookingInfo(orgSlug, estSlug);
  if (!info) return { error: "Este establecimiento no acepta reservas online" };
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
    const when = new Intl.DateTimeFormat("es-ES", {
      timeZone: info.timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(result.startsAt);
    const head =
      result.status === "confirmed"
        ? "¡Reserva confirmada!"
        : "Solicitud recibida: el restaurante la revisará y te contactará para confirmarla.";
    return {
      ok: true,
      message: `${head} ${result.partySize} personas, ${when}. Código de reserva: ${result.code}. Para cambios o cancelaciones, contacta con el restaurante indicando este código.`,
    };
  } catch (err) {
    return toFormState(err);
  }
}
