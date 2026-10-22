import "server-only";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { requireUser } from "@/server/auth/current-user";
import type { Tx } from "@/server/db/pool";
import { withTenant, type TenantContext } from "@/server/tenancy/context";
import { toFormState } from "./form-state";

/**
 * Ejecuta una operación de servicio dentro del contexto de la organización
 * (validado en servidor), revalida la ruta y devuelve un estado de formulario.
 */
export async function runTenantAction(
  orgId: string,
  revalidate: string,
  op: (tx: Tx, ctx: TenantContext) => Promise<unknown>,
  successMessage?: string,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, op);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(revalidate);
  return successMessage ? { ok: true, message: successMessage } : { ok: true };
}

export function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
