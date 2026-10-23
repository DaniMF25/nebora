"use server";

import type { FormState } from "@/lib/form-state";
import { redirect } from "next/navigation";
import { toFormState } from "@/server/actions/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { requireUser } from "@/server/auth/current-user";
import { applyCount, cancelCount, openCount, saveCountLines, transferStock } from "@/server/modules/inventory/operations";
import { withTenant } from "@/server/tenancy/context";
import {
  correctMovement,
  createIngredient,
  createWarehouse,
  recordMovement,
  updateIngredient,
} from "@/server/modules/inventory/service";

const path = (orgId: string) => `/app/${orgId}/inventory`;

export async function recordMovementAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const kind = formString(fd, "kind");
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) =>
      recordMovement(tx, ctx, {
        warehouseId: formString(fd, "warehouseId"),
        ingredientId: formString(fd, "ingredientId"),
        kind,
        quantity: formString(fd, "quantity"),
        unit: formString(fd, "unit"),
        ...(kind === "adjustment" ? { direction: formString(fd, "direction") } : {}),
        note: formString(fd, "note"),
        idempotencyKey: formString(fd, "idempotencyKey"),
      }),
    "Movimiento registrado",
  );
}

export async function correctMovementAction(
  orgId: string,
  movementId: string,
  idempotencyKey: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId), (tx, ctx) => correctMovement(tx, ctx, movementId, { idempotencyKey }));
}

export async function createIngredientAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const reorder = formString(fd, "reorderLevel");
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) =>
      createIngredient(tx, ctx, {
        name: formString(fd, "name"),
        baseUnit: formString(fd, "baseUnit"),
        ...(reorder ? { reorderLevel: reorder } : {}),
      }),
    "Ingrediente creado",
  );
}

export async function setIngredientActiveAction(
  orgId: string,
  ingredientId: string,
  active: boolean,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId), (tx, ctx) => updateIngredient(tx, ctx, ingredientId, { active }));
}

export async function createWarehouseAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) => createWarehouse(tx, ctx, formString(fd, "establishmentId"), { name: formString(fd, "name") }),
    "Almacén creado",
  );
}

export async function updateIngredientDetailsAction(
  orgId: string,
  ingredientId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const allergens = fd.getAll("allergens").filter((a): a is string => typeof a === "string");
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) =>
      updateIngredient(tx, ctx, ingredientId, {
        allergens,
        cost: formString(fd, "cost"),
        reorderLevel: formString(fd, "reorderLevel") || null,
      }),
    "Guardado",
  );
}

export async function transferStockAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) =>
      transferStock(tx, ctx, {
        fromWarehouseId: formString(fd, "fromWarehouseId"),
        toWarehouseId: formString(fd, "toWarehouseId"),
        ingredientId: formString(fd, "ingredientId"),
        quantity: formString(fd, "quantity"),
        unit: formString(fd, "unit"),
        note: formString(fd, "note"),
        idempotencyKey: formString(fd, "idempotencyKey"),
      }),
    "Traspaso registrado",
  );
}

export async function openCountAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let countId: string;
  try {
    countId = await withTenant(user, orgId, (tx, ctx) =>
      openCount(tx, ctx, { warehouseId: formString(fd, "warehouseId"), note: formString(fd, "note") }),
    );
  } catch (err) {
    return toFormState(err);
  }
  redirect(`/app/${orgId}/inventory/counts/${countId}`);
}

const countPath = (orgId: string, countId: string) => `/app/${orgId}/inventory/counts/${countId}`;

export async function saveCountLinesAction(orgId: string, countId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const ids = fd.getAll("ingredientId").filter((v): v is string => typeof v === "string");
  const lines = ids.map((id) => ({
    ingredientId: id,
    quantity: formString(fd, `q-${id}`),
    unit: formString(fd, `u-${id}`),
  }));
  return runTenantAction(orgId, countPath(orgId, countId), (tx, ctx) => saveCountLines(tx, ctx, countId, { lines }), "Recuento guardado");
}

export async function applyCountAction(orgId: string, countId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  let changes = 0;
  const state = await runTenantAction(orgId, countPath(orgId, countId), async (tx, ctx) => {
    changes = await applyCount(tx, ctx, countId);
  });
  if (!state.ok) return state;
  return { ok: true, message: changes === 0 ? "Recuento aplicado: sin diferencias" : `Recuento aplicado: ${changes} ajustes` };
}

export async function cancelCountAction(orgId: string, countId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, countPath(orgId, countId), (tx, ctx) => cancelCount(tx, ctx, countId), "Recuento cancelado");
}
