"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { applyRecipeAllergens, produceRecipe, removeRecipeLine, setRecipeLine } from "@/server/modules/recipes/service";

const path = (orgId: string, productId: string) => `/app/${orgId}/products/${productId}`;

export async function setRecipeLineAction(orgId: string, productId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, productId),
    (tx, ctx) =>
      setRecipeLine(tx, ctx, productId, {
        ingredientId: formString(fd, "ingredientId"),
        quantity: formString(fd, "quantity"),
        unit: formString(fd, "unit"),
      }),
    "Receta actualizada",
  );
}

export async function removeRecipeLineAction(
  orgId: string,
  productId: string,
  lineId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, productId), (tx, ctx) => removeRecipeLine(tx, ctx, productId, lineId));
}

export async function applyRecipeAllergensAction(
  orgId: string,
  productId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, productId),
    (tx, ctx) => applyRecipeAllergens(tx, ctx, productId),
    "Alérgenos declarados. Vuelve a publicar las cartas para que se vean en la página pública.",
  );
}

export async function produceRecipeAction(orgId: string, productId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const portions = Number(formString(fd, "portions"));
  // Se revalida esta página para que el formulario reciba una clave nueva: con
  // la misma clave, una segunda elaboración se trataría como reintento.
  return runTenantAction(
    orgId,
    path(orgId, productId),
    (tx, ctx) =>
      produceRecipe(tx, ctx, {
        productId,
        warehouseId: formString(fd, "warehouseId"),
        portions: Number.isFinite(portions) ? portions : -1,
        idempotencyKey: formString(fd, "idempotencyKey"),
      }),
    "Elaboración registrada: ingredientes descontados del stock",
  );
}
