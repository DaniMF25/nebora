"use server";

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
