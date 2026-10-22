"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { formToObject, toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import {
  changeMemberRole,
  createInvitation,
  removeMember,
  revokeInvitation,
} from "@/server/modules/members/service";
import { withTenant } from "@/server/tenancy/context";

// orgId y los ids ligados llegan del cliente; withTenant y los servicios los validan.

export async function createInvitationAction(orgId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const { token } = await withTenant(user, orgId, (tx, ctx) =>
      createInvitation(tx, ctx, formToObject(formData, ["email", "role"])),
    );
    revalidatePath(`/app/${orgId}/members`);
    return { ok: true, invitePath: `/invite/${token}` };
  } catch (err) {
    return toFormState(err);
  }
}

export async function revokeInvitationAction(
  orgId: string,
  invitationId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) => revokeInvitation(tx, ctx, invitationId));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/app/${orgId}/members`);
  return { ok: true };
}

export async function changeRoleAction(
  orgId: string,
  membershipId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) =>
      changeMemberRole(tx, ctx, membershipId, formToObject(formData, ["role"])),
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/app/${orgId}/members`);
  return { ok: true, message: "Rol actualizado" };
}

export async function removeMemberAction(
  orgId: string,
  membershipId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) => removeMember(tx, ctx, membershipId));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/app/${orgId}/members`);
  return { ok: true };
}
