"use server";

import type { FormState } from "@/lib/form-state";
import { parseEuroAmount } from "@/lib/money";
import { formString, runTenantAction } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import { getEstablishment } from "@/server/modules/establishments/service";
import { addSpecial, removeSpecial } from "@/server/modules/menus/specials";
import { localDateOf } from "@/server/modules/schedules/time";

// Los ids ligados llegan del cliente: el servicio comprueba local y organización.
const menusPath = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}/menus`;

/** Añade un plato fuera de carta. «Solo hoy» usa la fecha local del establecimiento. */
export async function addSpecialAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const price = formString(fd, "price");
  const cents = price === "" ? null : parseEuroAmount(price);
  if (cents === null && price !== "") return { error: "Precio no válido (por ejemplo 12,50)" };
  return runTenantAction(
    orgId,
    menusPath(orgId, estId),
    async (tx, ctx) => {
      let startsOn: string | null = formString(fd, "startsOn") || null;
      let endsOn: string | null = formString(fd, "endsOn") || null;
      if (fd.get("today") === "on") {
        const today = localDateOf(new Date(), (await getEstablishment(tx, ctx, estId)).timezone);
        startsOn = today;
        endsOn = today;
      }
      if (!formString(fd, "productId")) throw new ValidationError("Elige un plato");
      await addSpecial(tx, ctx, estId, {
        productId: formString(fd, "productId"),
        priceOverrideCents: cents,
        startsOn,
        endsOn,
      });
    },
    "Añadido fuera de carta",
  );
}

export async function removeSpecialAction(
  orgId: string,
  estId: string,
  specialId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    menusPath(orgId, estId),
    (tx, ctx) => removeSpecial(tx, ctx, estId, specialId),
    "Quitado de fuera de carta",
  );
}
