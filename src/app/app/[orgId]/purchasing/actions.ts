"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import { requireUser } from "@/server/auth/current-user";
import { toFormState } from "@/server/actions/form-state";
import { createOrder, createSupplier, setSupplierActive } from "@/server/modules/purchasing/service";
import { withTenant } from "@/server/tenancy/context";

const path = (orgId: string) => `/app/${orgId}/purchasing`;
// Proveedores (catálogo) y listados de compras del grupo y de cada local: se revalida toda la organización.
const revalidateAll = (orgId: string) => `/app/${orgId}`;

export async function createSupplierAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    revalidateAll(orgId),
    (tx, ctx) =>
      createSupplier(tx, ctx, {
        name: formString(fd, "name"),
        contactName: formString(fd, "contactName"),
        email: formString(fd, "email"),
        phone: formString(fd, "phone"),
        notes: formString(fd, "notes"),
      }),
    "Proveedor creado",
  );
}

export async function setSupplierActiveAction(
  orgId: string,
  supplierId: string,
  active: boolean,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, revalidateAll(orgId), (tx, ctx) => setSupplierActive(tx, ctx, supplierId, active));
}

export async function createOrderAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    id = await withTenant(user, orgId, (tx, ctx) =>
      createOrder(tx, ctx, {
        supplierId: formString(fd, "supplierId"),
        warehouseId: formString(fd, "warehouseId"),
        expectedDate: formString(fd, "expectedDate"),
        notes: formString(fd, "notes"),
      }),
    );
  } catch (err) {
    return toFormState(err);
  }
  redirect(`${path(orgId)}/${id}`);
}
