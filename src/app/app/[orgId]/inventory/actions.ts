"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
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
