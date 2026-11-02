"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { readProductForm } from "@/server/actions/product-form";
import { runTenantAction } from "@/server/actions/run";
import { createProduct, deleteProduct, updateProduct } from "@/server/modules/menus/products";
import { isUuid } from "@/server/validation";

export async function createProductAction(orgId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runTenantAction(orgId, `/app/${orgId}`, (tx, ctx) => createProduct(tx, ctx, readProductForm(formData)), "Producto creado");
}

export async function updateProductAction(
  orgId: string,
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    `/app/${orgId}`,
    (tx, ctx) => updateProduct(tx, ctx, productId, { ...readProductForm(formData), active: formData.get("active") === "on" }),
    "Guardado",
  );
}

export async function deleteProductAction(
  orgId: string,
  productId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, `/app/${orgId}`, (tx, ctx) => deleteProduct(tx, ctx, productId));
}

/** Eliminar desde la ficha del plato: al terminar vuelve a la carta de origen o al inicio. */
export async function deleteDishAction(
  orgId: string,
  productId: string,
  menuId: string | null,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  const state = await runTenantAction(orgId, `/app/${orgId}`, (tx, ctx) => deleteProduct(tx, ctx, productId));
  if (!state.ok) return state;
  // La ruta se compone aquí con un id validado: no es una redirección abierta.
  redirect(menuId && isUuid(menuId) ? `/app/${orgId}/menus/${menuId}` : `/app/${orgId}`);
}
