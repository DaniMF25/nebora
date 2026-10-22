"use server";

import type { FormState } from "@/lib/form-state";
import { formString, runTenantAction } from "@/server/actions/run";
import {
  cancelOrder,
  markOrderSent,
  receiveOrder,
  removeOrderLine,
  setOrderLine,
} from "@/server/modules/purchasing/service";

const path = (orgId: string, orderId: string) => `/app/${orgId}/purchasing/${orderId}`;

export async function setOrderLineAction(orgId: string, orderId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, orderId), (tx, ctx) =>
    setOrderLine(tx, ctx, orderId, {
      ingredientId: formString(fd, "ingredientId"),
      quantity: formString(fd, "quantity"),
      unit: formString(fd, "unit"),
      unitPrice: formString(fd, "unitPrice"),
    }),
  );
}

export async function removeOrderLineAction(
  orgId: string,
  orderId: string,
  lineId: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, orderId), (tx, ctx) => removeOrderLine(tx, ctx, orderId, lineId));
}

export async function markSentAction(orgId: string, orderId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, orderId), (tx, ctx) => markOrderSent(tx, ctx, orderId));
}

export async function cancelOrderAction(orgId: string, orderId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, orderId), (tx, ctx) => cancelOrder(tx, ctx, orderId));
}

export async function receiveOrderAction(orgId: string, orderId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const lineIds = fd.getAll("lineId").filter((v): v is string => typeof v === "string");
  const lines = lineIds.map((lineId) => ({
    lineId,
    quantity: formString(fd, `qty-${lineId}`),
    unit: formString(fd, `unit-${lineId}`),
  }));
  return runTenantAction(
    orgId,
    path(orgId, orderId),
    (tx, ctx) =>
      receiveOrder(tx, ctx, orderId, {
        lines,
        note: formString(fd, "note"),
        updateCosts: fd.get("updateCosts") === "on",
        idempotencyKey: formString(fd, "idempotencyKey"),
      }),
    "Recepción registrada: stock actualizado",
  );
}
