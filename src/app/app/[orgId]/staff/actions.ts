"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { createStaffMember, deleteStaffMember, updateStaffMember } from "@/server/modules/staff/service";

const path = (orgId: string) => `/app/${orgId}/staff`;

function memberInput(fd: FormData) {
  return {
    name: formString(fd, "name"),
    position: formString(fd, "position"),
    // Sin el desplegable de cuentas en el formulario, el vínculo no cambia.
    ...(fd.has("userId") ? { userId: formString(fd, "userId") } : {}),
  };
}

export async function createStaffMemberAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) => createStaffMember(tx, ctx, memberInput(fd)),
    "Persona añadida",
  );
}

export async function updateStaffMemberAction(
  orgId: string,
  id: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) => updateStaffMember(tx, ctx, id, { ...memberInput(fd), active: fd.get("active") === "on" }),
    "Cambios guardados",
  );
}

export async function deleteStaffMemberAction(
  orgId: string,
  id: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId), (tx, ctx) => deleteStaffMember(tx, ctx, id), "Persona eliminada");
}
