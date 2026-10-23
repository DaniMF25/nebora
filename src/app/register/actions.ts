"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { setSessionCookie } from "@/server/auth/current-user";
import { createSession, registerUser } from "@/server/auth/service";
import { clientIdentifier } from "@/server/request-ip";

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await registerUser(formToObject(formData, ["email", "displayName", "password"]), {
      clientId: await clientIdentifier(),
    });
    await setSessionCookie(await createSession(user.id));
  } catch (err) {
    return toFormState(err);
  }
  redirect("/app");
}
