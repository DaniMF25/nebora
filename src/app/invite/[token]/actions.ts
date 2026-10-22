"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { requireUser, setSessionCookie } from "@/server/auth/current-user";
import { createSession } from "@/server/auth/service";
import { acceptInvitation, registerWithInvitation } from "@/server/modules/members/service";

export async function acceptInvitationAction(token: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let orgId: string;
  try {
    orgId = await acceptInvitation(user, token);
  } catch (err) {
    return toFormState(err);
  }
  redirect(`/app/${orgId}`);
}

export async function registerWithInvitationAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let orgId: string;
  try {
    const result = await registerWithInvitation(token, formToObject(formData, ["displayName", "password"]));
    await setSessionCookie(await createSession(result.user.id));
    orgId = result.organizationId;
  } catch (err) {
    return toFormState(err);
  }
  redirect(`/app/${orgId}`);
}
