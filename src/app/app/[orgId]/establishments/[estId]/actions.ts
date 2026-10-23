"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { MAX_SLOTS_PER_DAY } from "@/lib/schedule-form";
import { toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import { ValidationError } from "@/server/errors";
import { updateEstablishment } from "@/server/modules/establishments/service";
import { createMenu } from "@/server/modules/menus/menus";
import { deleteDateException, setDateException, setWeeklyHours } from "@/server/modules/schedules/service";
import { withTenant } from "@/server/tenancy/context";


function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Lee pares apertura/cierre del formulario; un par a medias es un error. */
type SlotInput = { opens: string; closes: string };

function readSlots(formData: FormData, prefix: string): SlotInput[] {
  const slots: SlotInput[] = [];
  for (let n = 0; n < MAX_SLOTS_PER_DAY; n++) {
    const opens = str(formData, `${prefix}s${n}o`);
    const closes = str(formData, `${prefix}s${n}c`);
    if (!opens && !closes) continue;
    if (!opens || !closes) throw new ValidationError("Cada turno necesita hora de apertura y de cierre");
    slots.push({ opens, closes });
  }
  return slots;
}

function path(orgId: string, estId: string) {
  return `/app/${orgId}/establishments/${estId}`;
}

export async function saveWeeklyHoursAction(
  orgId: string,
  estId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    const slots: (SlotInput & { weekday: number })[] = [];
    for (let weekday = 1; weekday <= 7; weekday++) {
      for (const s of readSlots(formData, `d${weekday}`)) slots.push({ weekday, ...s });
    }
    await withTenant(user, orgId, (tx, ctx) => setWeeklyHours(tx, ctx, estId, { slots }));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(path(orgId, estId));
  return { ok: true, message: "Horario guardado" };
}

export async function saveExceptionAction(
  orgId: string,
  estId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    const closed = formData.get("closed") === "on";
    const input = {
      date: str(formData, "date"),
      closed,
      slots: closed ? [] : readSlots(formData, "x"),
      note: str(formData, "note"),
    };
    await withTenant(user, orgId, (tx, ctx) => setDateException(tx, ctx, estId, input));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(path(orgId, estId));
  return { ok: true, message: "Excepción guardada" };
}

export async function deleteExceptionAction(
  orgId: string,
  estId: string,
  date: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) => deleteDateException(tx, ctx, estId, date));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(path(orgId, estId));
  return { ok: true };
}

export async function createMenuAction(
  orgId: string,
  estId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let menuId: string;
  try {
    const menu = await withTenant(user, orgId, (tx, ctx) =>
      createMenu(tx, ctx, estId, { name: str(formData, "name"), slug: str(formData, "slug"), theme: str(formData, "theme") }),
    );
    menuId = menu.id;
  } catch (err) {
    return toFormState(err);
  }
  redirect(`/app/${orgId}/menus/${menuId}`);
}

export async function updateEstablishmentAction(
  orgId: string,
  estId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await withTenant(user, orgId, (tx, ctx) =>
      updateEstablishment(tx, ctx, estId, {
        name: str(formData, "name"),
        slug: str(formData, "slug"),
        timezone: str(formData, "timezone"),
        address: str(formData, "address"),
      }),
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/app/${orgId}`, "layout");
  return { ok: true, message: "Datos del local guardados" };
}
