"use server";

import type { FormState } from "@/lib/form-state";
import { runTenantAction } from "@/server/actions/run";
import { deleteMessage, setMessageStatus } from "@/server/modules/contact/service";

const path = (orgId: string, estId: string) => `/app/${orgId}/establishments/${estId}`;

export async function setMessageStatusAction(
  orgId: string,
  estId: string,
  id: string,
  status: "new" | "read" | "archived",
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => setMessageStatus(tx, ctx, estId, id, { status }));
}

export async function deleteMessageAction(
  orgId: string,
  estId: string,
  id: string,
  _p: FormState,
  _fd: FormData,
): Promise<FormState> {
  return runTenantAction(orgId, path(orgId, estId), (tx, ctx) => deleteMessage(tx, ctx, estId, id));
}
