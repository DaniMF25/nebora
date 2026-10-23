"use server";

import type { FormState } from "@/lib/form-state";
import type { LookupState } from "@/lib/privacy-lookup";
import { formString, runTenantAction } from "@/server/actions/run";
import { toFormState } from "@/server/actions/form-state";
import { requireUser } from "@/server/auth/current-user";
import {
  applyRetention,
  eraseCustomerData,
  findCustomerData,
  findCustomerWaitlist,
  updatePrivacySettings,
} from "@/server/modules/privacy/service";
import { withTenant } from "@/server/tenancy/context";

const path = (orgId: string) => `/app/${orgId}/privacy`;

export async function updatePrivacySettingsAction(orgId: string, _p: FormState, fd: FormData): Promise<FormState> {
  return runTenantAction(
    orgId,
    path(orgId),
    (tx, ctx) =>
      updatePrivacySettings(tx, ctx, { customerRetentionDays: Number(formString(fd, "customerRetentionDays")) }),
    "Plazo guardado",
  );
}

export async function applyRetentionAction(orgId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  let n = 0;
  const state = await runTenantAction(orgId, path(orgId), async (tx, ctx) => {
    n = await applyRetention(tx, ctx);
  });
  return state.ok ? { ok: true, message: `${n} registro(s) de clientes anonimizado(s)` } : state;
}

const STATUS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Finalizada",
  cancelled: "Cancelada",
  no_show: "No presentada",
};

const WAITLIST_STATUS: Record<string, string> = {
  waiting: "En espera",
  converted: "Convertida en reserva",
  cancelled: "Cancelada",
};

/** Búsqueda por correo o teléfono. Se hace por POST para que el dato no quede en la URL. */
export async function searchCustomerAction(orgId: string, _p: LookupState, fd: FormData): Promise<LookupState> {
  const user = await requireUser();
  const contact = formString(fd, "contact");
  try {
    const { rows, waitlist } = await withTenant(user, orgId, async (tx, ctx) => ({
      rows: await findCustomerData(tx, ctx, contact),
      waitlist: await findCustomerWaitlist(tx, ctx, contact),
    }));
    const fmt = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Madrid",
    });
    return {
      contact,
      results: [
        ...rows.map((r) => ({
          id: r.id,
          when: fmt.format(r.startsAt),
          establishment: r.establishmentName,
          partySize: r.partySize,
          status: STATUS[r.status] ?? r.status,
          channel: r.source === "public" ? "Web" : "Restaurante",
          name: r.customerName,
          phone: r.customerPhone,
          email: r.customerEmail,
        })),
        ...waitlist.map((w) => ({
          id: w.id,
          when: w.desiredDate,
          establishment: w.establishmentName,
          partySize: w.partySize,
          status: WAITLIST_STATUS[w.status] ?? w.status,
          channel: "Lista de espera",
          name: w.customerName,
          phone: w.customerPhone,
          email: w.customerEmail,
        })),
      ],
    };
  } catch (err) {
    return { contact, error: toFormState(err).error };
  }
}

export async function eraseCustomerAction(orgId: string, contact: string): Promise<LookupState> {
  const user = await requireUser();
  try {
    const n = await withTenant(user, orgId, (tx, ctx) => eraseCustomerData(tx, ctx, contact));
    return { contact, results: [], message: `Datos borrados: ${n} reserva(s) anonimizada(s).` };
  } catch (err) {
    return { contact, error: toFormState(err).error };
  }
}
