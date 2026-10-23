"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import {
  createTable,
  createZone,
  deleteTable,
  deleteZone,
  moveTable,
  updateTable,
  updateZone,
} from "@/server/modules/floor/service";

const path = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}/floor`;

function int(fd: FormData, key: string): number | undefined {
  const v = formString(fd, key);
  if (v === "") return undefined;
  const n = Number(v);
  // Un valor no numérico llega al esquema como NaN y se rechaza allí.
  return Number.isInteger(n) ? n : Number.NaN;
}

export async function createZoneAction(orgId: string, estId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      createZone(tx, ctx, estId, {
        name: formString(fd, "name"),
        planWidth: int(fd, "planWidth"),
        planHeight: int(fd, "planHeight"),
      }),
    "Zona creada",
  );
}

export async function updateZoneAction(
  orgId: string,
  estId: string,
  zoneId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      updateZone(tx, ctx, zoneId, {
        name: formString(fd, "name"),
        planWidth: int(fd, "planWidth"),
        planHeight: int(fd, "planHeight"),
      }),
    "Zona guardada",
  );
}

export async function deleteZoneAction(
  orgId: string,
  estId: string,
  zoneId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => deleteZone(tx, ctx, zoneId));
}

export async function createTableAction(
  orgId: string,
  estId: string,
  zoneId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      createTable(tx, ctx, zoneId, {
        name: formString(fd, "name"),
        minCapacity: int(fd, "minCapacity"),
        maxCapacity: int(fd, "maxCapacity"),
        shape: formString(fd, "shape"),
        width: int(fd, "width"),
        height: int(fd, "height"),
      }),
    "Mesa creada",
  );
}

export async function updateTableAction(
  orgId: string,
  estId: string,
  tableId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, estId),
    (tx, ctx) =>
      updateTable(tx, ctx, tableId, {
        name: formString(fd, "name"),
        minCapacity: int(fd, "minCapacity"),
        maxCapacity: int(fd, "maxCapacity"),
        shape: formString(fd, "shape"),
        width: int(fd, "width"),
        height: int(fd, "height"),
        active: fd.get("active") === "on",
      }),
    "Mesa guardada",
  );
}

export async function deleteTableAction(
  orgId: string,
  estId: string,
  tableId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => deleteTable(tx, ctx, tableId));
}

/** Usada por el plano interactivo (arrastrar o teclado). */
export async function moveTableAction(
  orgId: string,
  estId: string,
  tableId: string,
  x: number,
  y: number,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => moveTable(tx, ctx, tableId, { x, y }));
}
