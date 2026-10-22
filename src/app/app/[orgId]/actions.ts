"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import { createEstablishment } from "@/server/modules/establishments/service";
import { withTenant } from "@/server/tenancy/context";

/**
 * `orgId` llega del cliente (argumento ligado en el formulario). `withTenant`
 * lo valida contra la membresía del usuario autenticado antes de operar.
 */
export async function createEstablishmentAction(
  orgId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) =>
      createEstablishment(tx, ctx, formToObject(formData, ["name", "slug", "timezone", "address"])),
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/app/${orgId}`);
  return { ok: true };
}
