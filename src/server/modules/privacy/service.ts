import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { ValidationError } from "@/server/errors";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { parseInput } from "@/server/validation";

export const DEFAULT_RETENTION_DAYS = 365;

export interface PrivacySettings {
  customerRetentionDays: number;
}

export interface CustomerReservation {
  id: string;
  establishmentName: string;
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  status: string;
  source: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  consentAt: Date | null;
  createdAt: Date;
}

export interface CustomerWaitlistEntry {
  id: string;
  establishmentName: string;
  desiredDate: string;
  partySize: number;
  status: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  createdAt: Date;
}

export const privacySettingsSchema = z
  .object({ customerRetentionDays: z.number().int().min(30).max(3650) })
  .strict();

/** Un contacto es un correo (sin distinguir mayúsculas) o un teléfono (sin espacios ni guiones). */
export type Contact = { kind: "email"; value: string } | { kind: "phone"; value: string };

export function normalizeContact(input: unknown): Contact {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    if (!z.email().safeParse(email).success || email.length > 254) throw new ValidationError("Correo no válido");
    return { kind: "email", value: email };
  }
  const phone = raw.replace(/[^0-9+]/g, "");
  if (!/^\+?[0-9]{6,20}$/.test(phone)) throw new ValidationError("Indica un correo o un teléfono válido");
  return { kind: "phone", value: phone };
}

/** Huella del contacto para la auditoría: nunca se registra en claro. */
function contactFingerprint(c: Contact): string {
  return createHash("sha256").update(`${c.kind}:${c.value}`).digest("hex").slice(0, 16);
}

const MATCH_SQL = `(
  ($2 = 'email' AND lower(r.customer_email) = $3) OR
  ($2 = 'phone' AND regexp_replace(r.customer_phone, '[^0-9+]', '', 'g') = $3)
)`;

export async function getPrivacySettings(tx: Tx, ctx: TenantContext): Promise<PrivacySettings> {
  requirePermission(ctx, "privacy.manage");
  const { rows } = await tx.query<PrivacySettings>(
    `SELECT customer_retention_days AS "customerRetentionDays" FROM privacy_settings WHERE organization_id = $1`,
    [ctx.organizationId],
  );
  return rows[0] ?? { customerRetentionDays: DEFAULT_RETENTION_DAYS };
}

export async function updatePrivacySettings(tx: Tx, ctx: TenantContext, input: unknown): Promise<PrivacySettings> {
  requirePermission(ctx, "privacy.manage");
  const d = parseInput(privacySettingsSchema, input);
  await tx.query(
    `INSERT INTO privacy_settings (organization_id, customer_retention_days) VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET customer_retention_days = EXCLUDED.customer_retention_days`,
    [ctx.organizationId, d.customerRetentionDays],
  );
  await recordAudit(tx, ctx, {
    action: "privacy.settings_updated",
    entityType: "organization",
    entityId: ctx.organizationId,
    metadata: { customerRetentionDays: d.customerRetentionDays },
  });
  return getPrivacySettings(tx, ctx);
}

/** Anonimiza ya las reservas que superan el plazo de conservación. */
export async function applyRetention(tx: Tx, ctx: TenantContext): Promise<number> {
  requirePermission(ctx, "privacy.manage");
  const { rows } = await tx.query<{ n: number }>("SELECT app.anonymize_expired_reservations($1) AS n", [
    ctx.organizationId,
  ]);
  return rows[0]!.n;
}

/** Reservas de la organización (todos sus locales) asociadas a un contacto. */
export async function findCustomerData(tx: Tx, ctx: TenantContext, contactInput: unknown): Promise<CustomerReservation[]> {
  requirePermission(ctx, "privacy.manage");
  const c = normalizeContact(contactInput);
  const { rows } = await tx.query<CustomerReservation>(
    `SELECT r.id, e.name AS "establishmentName", r.starts_at AS "startsAt", r.ends_at AS "endsAt",
            r.party_size AS "partySize", r.status, r.source, r.customer_name AS "customerName",
            r.customer_phone AS "customerPhone", r.customer_email AS "customerEmail", r.notes,
            r.consent_at AS "consentAt", r.created_at AS "createdAt"
       FROM reservations r
       JOIN establishments e ON e.organization_id = r.organization_id AND e.id = r.establishment_id
      WHERE r.organization_id = $1 AND r.anonymized_at IS NULL AND ${MATCH_SQL}
      ORDER BY r.starts_at DESC`,
    [ctx.organizationId, c.kind, c.value],
  );
  return rows;
}

/** Entradas de la lista de espera (todos los locales) asociadas a un contacto. */
export async function findCustomerWaitlist(
  tx: Tx,
  ctx: TenantContext,
  contactInput: unknown,
): Promise<CustomerWaitlistEntry[]> {
  requirePermission(ctx, "privacy.manage");
  const c = normalizeContact(contactInput);
  const { rows } = await tx.query<CustomerWaitlistEntry>(
    `SELECT r.id, e.name AS "establishmentName", r.desired_date::text AS "desiredDate", r.party_size AS "partySize",
            r.status, r.customer_name AS "customerName", r.customer_phone AS "customerPhone",
            r.customer_email AS "customerEmail", r.notes, r.created_at AS "createdAt"
       FROM waitlist_entries r
       JOIN establishments e ON e.organization_id = r.organization_id AND e.id = r.establishment_id
      WHERE r.organization_id = $1 AND r.anonymized_at IS NULL AND ${MATCH_SQL}
      ORDER BY r.desired_date DESC`,
    [ctx.organizationId, c.kind, c.value],
  );
  return rows;
}

/** Copia de los datos de un cliente (derecho de acceso/portabilidad). */
export async function exportCustomerData(tx: Tx, ctx: TenantContext, contactInput: unknown) {
  const reservations = await findCustomerData(tx, ctx, contactInput);
  const waitlist = await findCustomerWaitlist(tx, ctx, contactInput);
  const c = normalizeContact(contactInput);
  const org = await tx.query<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [ctx.organizationId]);
  await recordAudit(tx, ctx, {
    action: "privacy.exported",
    entityType: "organization",
    entityId: ctx.organizationId,
    metadata: { contact: contactFingerprint(c), reservations: reservations.length, waitlist: waitlist.length },
  });
  return {
    generatedAt: new Date().toISOString(),
    controller: org.rows[0]!.name,
    contact: c.value,
    reservations: reservations.map((r) => ({
      establishment: r.establishmentName,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      partySize: r.partySize,
      status: r.status,
      channel: r.source === "public" ? "web" : "restaurante",
      name: r.customerName,
      phone: r.customerPhone,
      email: r.customerEmail,
      notes: r.notes,
      consentAt: r.consentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    waitlist: waitlist.map((w) => ({
      establishment: w.establishmentName,
      desiredDate: w.desiredDate,
      partySize: w.partySize,
      status: w.status,
      name: w.customerName,
      phone: w.customerPhone,
      email: w.customerEmail,
      notes: w.notes,
      createdAt: w.createdAt.toISOString(),
    })),
  };
}

/**
 * Borra (anonimiza) los datos personales de un cliente en todas sus reservas.
 * Si tiene reservas futuras activas, se exige cancelarlas antes para no
 * dejar al restaurante con reservas sin forma de contacto.
 */
export async function eraseCustomerData(tx: Tx, ctx: TenantContext, contactInput: unknown): Promise<number> {
  requirePermission(ctx, "privacy.manage");
  const c = normalizeContact(contactInput);
  const active = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM reservations r
      WHERE r.organization_id = $1 AND r.anonymized_at IS NULL AND ${MATCH_SQL}
        AND r.status IN ('pending', 'confirmed', 'seated') AND r.ends_at > now()`,
    [ctx.organizationId, c.kind, c.value],
  );
  if (active.rows[0]!.n > 0) {
    throw new ValidationError(
      `Tiene ${active.rows[0]!.n} reserva(s) futura(s) activa(s): cancélala(s) antes de borrar sus datos`,
    );
  }
  const res = await tx.query(
    `UPDATE reservations r
        SET customer_name = 'Cliente anonimizado', customer_phone = NULL, customer_email = NULL, notes = NULL,
            anonymized_at = now()
      WHERE r.organization_id = $1 AND r.anonymized_at IS NULL AND ${MATCH_SQL}`,
    [ctx.organizationId, c.kind, c.value],
  );
  // Lista de espera: se anonimiza y, si seguía en espera, se cancela.
  const wl = await tx.query(
    `UPDATE waitlist_entries r
        SET customer_name = 'Cliente anonimizado', customer_phone = NULL, customer_email = NULL, notes = NULL,
            status = CASE WHEN status = 'waiting' THEN 'cancelled' ELSE status END, anonymized_at = now()
      WHERE r.organization_id = $1 AND r.anonymized_at IS NULL AND ${MATCH_SQL}`,
    [ctx.organizationId, c.kind, c.value],
  );
  await recordAudit(tx, ctx, {
    action: "privacy.erased",
    entityType: "organization",
    entityId: ctx.organizationId,
    metadata: { contact: contactFingerprint(c), reservations: res.rowCount ?? 0, waitlist: wl.rowCount ?? 0 },
  });
  return res.rowCount ?? 0;
}
