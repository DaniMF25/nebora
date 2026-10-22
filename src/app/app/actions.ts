"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import { createOrganization } from "@/server/modules/organizations/service";
import { withUser } from "@/server/tenancy/context";

export async function createOrganizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    id = await withUser(user, (tx, ctx) => createOrganization(tx, ctx, formToObject(formData, ["name", "slug"])));
  } catch (err) {
    return toFormState(err);
  }
  redirect(`/app/${id}`);
}
