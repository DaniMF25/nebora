"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { changePlan } from "@/server/modules/organizations/service";

export async function changePlanAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  // Revalida todo el panel de la organización: el menú cambia con el plan.
  return runTenantAction(
    orgId,
    `/app/${orgId}`,
    (tx, ctx) => changePlan(tx, ctx, { plan: formString(fd, "plan") }),
    "Plan cambiado",
  );
}

/** Activa un plan en una organización bloqueada (D-068) y lleva al inicio del panel, ya desbloqueado. */
export async function activatePlanAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const result = await runTenantAction(
    orgId,
    `/app/${orgId}`,
    (tx, ctx) => changePlan(tx, ctx, { plan: formString(fd, "plan") }),
    "Plan activado",
  );
  if (result.ok) redirect(`/app/${orgId}?plan=activado`);
  return result;
}
