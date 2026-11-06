"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import { createOrganization, listMyOrganizations } from "@/server/modules/organizations/service";
import { withUser } from "@/server/tenancy/context";

export async function createOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let target: string;
  try {
    target = await withUser(user, async (tx, ctx) => {
      const id = await createOrganization(tx, ctx, formToObject(formData, ["name", "slug"]));
      // Sin prueba nace bloqueada (D-068): directamente a elegir plan.
      const locked = (await listMyOrganizations(tx, ctx)).find((o) => o.id === id)?.lockedAt;
      return locked ? `/app/${id}/plan` : `/app/${id}`;
    });
  } catch (err) {
    return toFormState(err);
  }
  redirect(target);
}
