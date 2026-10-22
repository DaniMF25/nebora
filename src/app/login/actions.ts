"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from "@/server/auth/current-user";
import { login, revokeSession } from "@/server/auth/service";

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { session } = await login(formToObject(formData, ["email", "password"]));
    await setSessionCookie(session);
  } catch (err) {
    return toFormState(err);
  }
  redirect("/app");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(token);
  await clearSessionCookie();
  redirect("/login");
}
