"use server";

import type { FormState } from "@/lib/form-state";
import { parseEuroAmount } from "@/lib/money";
import { formString, runTenantAction } from "@/server/actions/run";
import { ValidationError } from "@/server/errors";
import { createProduct, deleteProduct, updateProduct } from "@/server/modules/menus/products";

function readProduct(formData: FormData) {
  const priceCents = parseEuroAmount(formString(formData, "price"));
  if (priceCents === null) throw new ValidationError("Precio no válido (por ejemplo 12,50)");
  const allergens = formData.getAll("allergens").filter((a): a is string => typeof a === "string");
  return {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    priceCents,
    // Se envían tal cual: el esquema del servicio rechaza códigos desconocidos.
    allergens,
  };
}

export async function createProductAction(orgId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return runTenantAction(orgId, `/app/${orgId}/products`, (tx, ctx) => createProduct(tx, ctx, readProduct(formData)), "Producto creado");
}

export async function updateProductAction(
  orgId: string,
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return runTenantAction(
    orgId,
    `/app/${orgId}/products`,
    (tx, ctx) => updateProduct(tx, ctx, productId, { ...readProduct(formData), active: formData.get("active") === "on" }),
    "Guardado",
  );
}

export async function deleteProductAction(
  orgId: string,
  productId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, `/app/${orgId}/products`, (tx, ctx) => deleteProduct(tx, ctx, productId));
}
