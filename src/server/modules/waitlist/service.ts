import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { createReservation, findAvailableTables, type Reservation } from "@/server/modules/reservations/service";
import { formatMinutes, isValidLocalDate, parseTime } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

// Lista de espera (migración 0015, D-026). No hay avisos automáticos (sin
// proveedor de SMS/correo): el panel indica cuándo hay hueco y el personal
// contacta al cliente y convierte la entrada en reserva.

export interface WaitlistEntry {
  id: string;
  desiredDate: string;
  windowStart: string;
  windowEnd: string;
  partySize: number;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  status: "waiting" | "converted" | "cancelled";
  reservationId: string | null;
  createdAt: Date;
  /** Primera hora de la franja con mesa libre (solo entradas en espera), o null. */
  availableAt: string | null;
}

/** Cada cuánto se prueba una hora dentro de la franja al buscar hueco. */
const PROBE_STEP_MINUTES = 15;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const fromSchema = z.string().refine((v) => parseTime(v) !== null, { message: "Hora no válida (HH:MM)" });
const toSchema = z.string().refine((v) => parseTime(v, true) !== null, { message: "Hora no válida (HH:MM)" });

export const waitlistEntrySchema = z
  .object({
    date: z.string().refine(isValidLocalDate, { message: "Fecha no válida" }),
    from: fromSchema,
    to: toSchema,
    partySize: z.number().int().min(1).max(100),
    customerName: z.string().trim().min(1, "Indica el nombre").max(120),
    customerPhone: optionalText(40),
    customerEmail: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Correo no válido" })
      .transform((v) => (v === "" ? null : v.toLowerCase()))
      .nullable()
      .optional(),
    notes: optionalText(300),
  })
  .strict()
  .refine((d) => d.customerPhone || d.customerEmail, {
    message: "Indica un teléfono o un correo para poder avisar",
    path: ["customerPhone"],
  })
  .refine((d) => parseTime(d.to, true)! > parseTime(d.from)!, {
    message: "La franja debe terminar después de empezar",
    path: ["to"],
  });

export const convertSchema = z
  .object({
    time: z.string().refine((v) => parseTime(v) !== null, { message: "Hora no válida (HH:MM)" }),
    durationMinutes: z.number().int().min(15).max(480),
  })
  .strict();

const ENTRY_SQL = `
  SELECT id, desired_date::text AS "desiredDate", window_start_minute AS ws, window_end_minute AS we,
         party_size AS "partySize", customer_name AS "customerName", customer_phone AS "customerPhone",
         customer_email AS "customerEmail", notes, status, reservation_id AS "reservationId",
         created_at AS "createdAt"
    FROM waitlist_entries`;

type EntryRow = Omit<WaitlistEntry, "windowStart" | "windowEnd" | "availableAt"> & { ws: number; we: number };

function toEntry(r: EntryRow, availableAt: string | null = null): WaitlistEntry {
  const { ws, we, ...rest } = r;
  return { ...rest, windowStart: formatMinutes(ws), windowEnd: formatMinutes(we), availableAt };
}

async function establishmentExists(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

/**
 * Primera hora de la franja en la que hay una mesa libre para el grupo
 * durante `durationMinutes` dentro del horario de apertura, o null.
 */
async function firstAvailableTime(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  e: { desiredDate: string; ws: number; we: number; partySize: number },
  durationMinutes: number,
): Promise<string | null> {
  for (let m = e.ws; m < e.we && m < 1440; m += PROBE_STEP_MINUTES) {
    const time = formatMinutes(m);
    try {
      const { tables } = await findAvailableTables(tx, ctx, establishmentId, {
        date: e.desiredDate,
        time,
        durationMinutes,
        partySize: e.partySize,
      });
      if (tables.some((t) => t.maxCapacity >= e.partySize)) return time;
    } catch (err) {
      // Fuera del horario de apertura: se prueba la siguiente hora.
      if (!(err instanceof ValidationError)) throw err;
    }
  }
  return null;
}

/** Entradas del día; las que siguen en espera indican si ya hay hueco. */
export async function listWaitlist(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  date: string,
  options: { durationMinutes?: number } = {},
): Promise<WaitlistEntry[]> {
  requirePermission(ctx, "reservations.read");
  if (!isValidLocalDate(date)) throw new ValidationError("Fecha no válida");
  await establishmentExists(tx, ctx, establishmentId);
  const { rows } = await tx.query<EntryRow>(
    `${ENTRY_SQL} WHERE organization_id = $1 AND establishment_id = $2 AND desired_date = $3
      ORDER BY (status = 'waiting') DESC, created_at`,
    [ctx.organizationId, establishmentId, date],
  );
  const duration = options.durationMinutes ?? 90;
  const result: WaitlistEntry[] = [];
  for (const r of rows) {
    const availableAt =
      r.status === "waiting" ? await firstAvailableTime(tx, ctx, establishmentId, r, duration) : null;
    result.push(toEntry(r, availableAt));
  }
  return result;
}

export async function addWaitlistEntry(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<WaitlistEntry> {
  requirePermission(ctx, "reservations.manage");
  const d = parseInput(waitlistEntrySchema, input);
  await establishmentExists(tx, ctx, establishmentId);
  const { rows } = await tx.query<EntryRow>(
    `INSERT INTO waitlist_entries (organization_id, establishment_id, desired_date, window_start_minute,
                                   window_end_minute, party_size, customer_name, customer_phone, customer_email,
                                   notes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, desired_date::text AS "desiredDate", window_start_minute AS ws, window_end_minute AS we,
               party_size AS "partySize", customer_name AS "customerName", customer_phone AS "customerPhone",
               customer_email AS "customerEmail", notes, status, reservation_id AS "reservationId",
               created_at AS "createdAt"`,
    [ctx.organizationId, establishmentId, d.date, parseTime(d.from)!, parseTime(d.to, true)!, d.partySize,
      d.customerName, d.customerPhone ?? null, d.customerEmail ?? null, d.notes ?? null, ctx.userId],
  );
  const entry = rows[0]!;
  // Sin datos personales en la auditoría.
  await recordAudit(tx, ctx, {
    action: "waitlist.added",
    entityType: "waitlist_entry",
    entityId: entry.id,
    metadata: { partySize: d.partySize },
  });
  return toEntry(entry);
}

async function lockWaiting(
  tx: Tx,
  ctx: TenantContext,
  entryId: string,
): Promise<EntryRow & { establishmentId: string }> {
  if (!isUuid(entryId)) throw new NotFoundError();
  const { rows } = await tx.query<EntryRow & { establishmentId: string }>(
    `${ENTRY_SQL.replace("SELECT id,", 'SELECT id, establishment_id AS "establishmentId",')}
      WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [ctx.organizationId, entryId],
  );
  const entry = rows[0];
  if (!entry) throw new NotFoundError();
  if (entry.status !== "waiting") throw new ConflictError("Esta entrada ya no está en espera");
  return entry;
}

export async function cancelWaitlistEntry(tx: Tx, ctx: TenantContext, entryId: string): Promise<void> {
  requirePermission(ctx, "reservations.manage");
  await lockWaiting(tx, ctx, entryId);
  await tx.query("UPDATE waitlist_entries SET status = 'cancelled' WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    entryId,
  ]);
  await recordAudit(tx, ctx, { action: "waitlist.cancelled", entityType: "waitlist_entry", entityId: entryId });
}

/**
 * Convierte la entrada en una reserva confirmada a la hora indicada, en la
 * mesa libre más ajustada al grupo. Atómico: o se crea la reserva y la entrada
 * queda enlazada, o no cambia nada.
 */
export async function convertWaitlistEntry(
  tx: Tx,
  ctx: TenantContext,
  entryId: string,
  input: unknown,
): Promise<Reservation> {
  requirePermission(ctx, "reservations.manage");
  const d = parseInput(convertSchema, input);
  const entry = await lockWaiting(tx, ctx, entryId);
  const { tables } = await findAvailableTables(tx, ctx, entry.establishmentId, {
    date: entry.desiredDate,
    time: d.time,
    durationMinutes: d.durationMinutes,
    partySize: entry.partySize,
  });
  const table = tables.find((t) => t.maxCapacity >= entry.partySize);
  if (!table) throw new ConflictError("Ya no hay mesa libre a esa hora para ese grupo");
  const { reservation } = await createReservation(tx, ctx, entry.establishmentId, {
    date: entry.desiredDate,
    time: d.time,
    durationMinutes: d.durationMinutes,
    partySize: entry.partySize,
    customerName: entry.customerName,
    customerPhone: entry.customerPhone ?? "",
    customerEmail: entry.customerEmail ?? "",
    notes: entry.notes ?? "",
    tableIds: [table.id],
  });
  await tx.query(
    "UPDATE waitlist_entries SET status = 'converted', reservation_id = $3 WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, entryId, reservation.id],
  );
  await recordAudit(tx, ctx, {
    action: "waitlist.converted",
    entityType: "waitlist_entry",
    entityId: entryId,
    metadata: { reservationId: reservation.id },
  });
  return reservation;
}
