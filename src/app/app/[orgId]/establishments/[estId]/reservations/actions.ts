"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { createReservation, setReservationStatus, updateReservation } from "@/server/modules/reservations/service";
import { updateReservationSettings } from "@/server/modules/reservations/settings";
import { addWaitlistEntry, cancelWaitlistEntry, convertWaitlistEntry } from "@/server/modules/waitlist/service";

const path = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}/reservations`;

function num(fd: FormData, key: string): number {
  const v = Number(formString(fd, key));
  return Number.isFinite(v) ? v : Number.NaN;
}

function reservationInput(fd: FormData) {
  return {
    date: formString(fd, "date"),
    time: formString(fd, "time"),
    durationMinutes: num(fd, "durationMinutes"),
    partySize: num(fd, "partySize"),
    customerName: formString(fd, "customerName"),
    customerPhone: formString(fd, "customerPhone"),
    customerEmail: formString(fd, "customerEmail"),
    notes: formString(fd, "notes"),
    tableIds: fd.getAll("tableIds").filter((v): v is string => typeof v === "string"),
  };
}

export async function createReservationAction(
  orgId: string,
  estId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      createReservation(tx, ctx, estId, {
        ...reservationInput(fd),
        status: formString(fd, "status") || "confirmed",
        idempotencyKey: formString(fd, "idempotencyKey"),
      }),
    "Reserva creada",
  );
}

export async function updateReservationAction(
  orgId: string,
  estId: string,
  reservationId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) => updateReservation(tx, ctx, reservationId, reservationInput(fd)),
    "Reserva modificada",
  );
}

export async function setStatusAction(
  orgId: string,
  estId: string,
  reservationId: string,
  status: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => setReservationStatus(tx, ctx, reservationId, status));
}

export async function updateSettingsAction(
  orgId: string,
  estId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      updateReservationSettings(tx, ctx, estId, {
        publicEnabled: fd.get("publicEnabled") === "on",
        minParty: num(fd, "minParty"),
        maxParty: num(fd, "maxParty"),
        durationMinutes: num(fd, "durationMinutes"),
        slotIntervalMinutes: num(fd, "slotIntervalMinutes"),
        minNoticeMinutes: Math.round(num(fd, "minNoticeHours") * 60),
        maxDaysAhead: num(fd, "maxDaysAhead"),
        autoConfirm: fd.get("autoConfirm") === "on",
      }),
    "Configuración guardada",
  );
}

export async function addWaitlistAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      addWaitlistEntry(tx, ctx, estId, {
        date: formString(fd, "date"),
        from: formString(fd, "from"),
        to: formString(fd, "to"),
        partySize: num(fd, "partySize"),
        customerName: formString(fd, "customerName"),
        customerPhone: formString(fd, "customerPhone"),
        customerEmail: formString(fd, "customerEmail"),
        notes: formString(fd, "notes"),
      }),
    "Añadido a la lista de espera",
  );
}

export async function convertWaitlistAction(
  orgId: string,
  estId: string,
  entryId: string,
  time: string,
  durationMinutes: number,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) =>
    convertWaitlistEntry(tx, ctx, entryId, { time, durationMinutes }),
  );
}

export async function cancelWaitlistAction(
  orgId: string,
  estId: string,
  entryId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => cancelWaitlistEntry(tx, ctx, entryId));
}
