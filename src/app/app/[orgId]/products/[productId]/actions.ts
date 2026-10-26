"use server";

import type { FormState } from "@/lib/form-state";
import { readImageField } from "@/server/actions/form-file";
import { formString, runTenantAction } from "@/server/actions/run";
import { setProductEstablishments, setProductImage } from "@/server/modules/menus/products";
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

export async function setProductImageAction(orgId: string, productId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId, productId),
    async (tx, ctx) => setProductImage(tx, ctx, productId, await readImageField(fd)),
    "Foto guardada. Vuelve a publicar las cartas para que se vea en la página pública.",
  );
}

export async function removeProductImageAction(orgId: string, productId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, productId), (tx, ctx) => setProductImage(tx, ctx, productId, null), "Foto quitada");
}

export async function setAvailabilityAction(
  orgId: string,
  productId: string,
  _p: FormState,
  fd: FormData,
): Promise<FormState> {
  const all = fd.get("scope") !== "some";
  const ids = fd.getAll("establishmentIds").filter((v): v is string => typeof v === "string");
  return runTenantAction(
    orgId,
    `/app/${orgId}`,
    (tx, ctx) => setProductEstablishments(tx, ctx, productId, { allEstablishments: all, establishmentIds: all ? [] : ids }),
    "Locales guardados",
  );
}
