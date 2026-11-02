"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/server/actions/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { requireUser } from "@/server/auth/current-user";
import { copyPreviousWeek, createShift, deleteShift, updateShift } from "@/server/modules/staff/service";
import { withTenant } from "@/server/tenancy/context";

const path = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}/staff`;

function shiftInput(fd: FormData) {
  return {
    staffMemberId: formString(fd, "staffMemberId"),
    date: formString(fd, "date"),
    start: formString(fd, "start"),
    end: formString(fd, "end"),
    position: formString(fd, "position"),
    notes: formString(fd, "notes"),
  };
}

export async function createShiftAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => createShift(tx, ctx, estId, shiftInput(fd)),
    "Turno añadido",
  );
}

export async function updateShiftAction(
  orgId: string,
  estId: string,
  shiftId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => updateShift(tx, ctx, estId, shiftId, shiftInput(fd)),
    "Turno modificado",
  );
}

export async function deleteShiftAction(
  orgId: string,
  estId: string,
  shiftId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => deleteShift(tx, ctx, estId, shiftId),
    "Turno eliminado",
  );
}

export async function copyPreviousWeekAction(
  orgId: string,
  estId: string,
  weekStart: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let result;
  try {
    result = await withTenant(user, orgId, (tx, ctx) => copyPreviousWeek(tx, ctx, estId, weekStart));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(path(orgId, estId));
  const { copied, skipped } = result;
  const message =
    copied === 0 && skipped === 0
      ? "La semana anterior no tiene turnos"
      : `${copied === 1 ? "1 turno copiado" : `${copied} turnos copiados`}` +
        (skipped > 0 ? ` · ${skipped} sin copiar (se solapaban o la persona está desactivada)` : "");
  return { ok: true, message };
}
