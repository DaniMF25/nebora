import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import { isUniqueViolation, type Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { getSchedule } from "@/server/modules/schedules/service";
import { addDays, isValidLocalDate, localToUtc, parseTime, resolveOpeningIntervals } from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

export const RESERVATION_STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Transiciones de estado permitidas. */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["seated", "cancelled", "no_show"],
  seated: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export interface ReservationTableRef {
  id: string;
  name: string;
  maxCapacity: number;
}

export interface Reservation {
  id: string;
  establishmentId: string;
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  status: ReservationStatus;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  source: "staff" | "public";
  tables: ReservationTableRef[];
}

export interface AvailableTable {
  id: string;
  name: string;
  zoneName: string;
  minCapacity: number;
  maxCapacity: number;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const slotSchema = {
  date: z.string().refine(isValidLocalDate, { message: "Fecha no válida" }),
  time: z.string().refine((v) => parseTime(v) !== null, { message: "Hora no válida (HH:MM)" }),
  durationMinutes: z.number().int().min(15).max(480),
  partySize: z.number().int().min(1).max(100),
};

export const reservationSchema = z
  .object({
    ...slotSchema,
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
    notes: optionalText(500),
    tableIds: z.array(z.string()).max(10).default([]),
    status: z.enum(["pending", "confirmed"]).default("confirmed"),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).optional(),
  })
  .strict();

export const availabilitySchema = z.object(slotSchema).strict();

const RESERVATION_SQL = `
  SELECT r.id, r.establishment_id AS "establishmentId", r.starts_at AS "startsAt", r.ends_at AS "endsAt",
         r.party_size AS "partySize", r.status, r.customer_name AS "customerName",
         r.customer_phone AS "customerPhone", r.customer_email AS "customerEmail", r.notes, r.source,
         COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'maxCapacity', t.max_capacity) ORDER BY t.name)
                     FROM reservation_tables rt
                     JOIN dining_tables t ON t.organization_id = rt.organization_id AND t.id = rt.table_id
                    WHERE rt.organization_id = r.organization_id AND rt.reservation_id = r.id), '[]') AS tables
    FROM reservations r`;

function mapReservationError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23P01" && e.constraint === "reservation_tables_no_overlap") {
    throw new ConflictError("Alguna de las mesas ya está reservada en ese horario");
  }
  if (isUniqueViolation(err, "reservations_idempotency_unique")) {
    throw new ConflictError("La reserva ya se está registrando; recarga la página");
  }
  throw err;
}

interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Convierte fecha y hora locales del establecimiento a un intervalo UTC y
 * comprueba que cae por completo dentro de un periodo de apertura.
 */
async function resolveSlot(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  d: { date: string; time: string; durationMinutes: number },
): Promise<Slot & { timezone: string }> {
  const schedule = await getSchedule(tx, ctx, establishmentId, { exceptionsFrom: addDays(d.date, -1) });
  const startsAt = localToUtc(d.date, parseTime(d.time)!, schedule.timezone);
  const endsAt = new Date(startsAt.getTime() + d.durationMinutes * 60_000);
  const intervals = resolveOpeningIntervals(schedule, schedule.timezone, d.date, 2);
  const fits = intervals.some((iv) => iv.start <= startsAt && endsAt <= iv.end);
  if (!fits) throw new ValidationError("El establecimiento no está abierto durante todo ese horario");
  return { startsAt, endsAt, timezone: schedule.timezone };
}

/** Valida que las mesas existen, son del establecimiento, están activas y caben los comensales. */
async function checkTables(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  tableIds: string[],
  partySize: number,
): Promise<string[]> {
  const ids = [...new Set(tableIds)];
  if (ids.length === 0) return [];
  if (!ids.every(isUuid)) throw new NotFoundError("Mesa no encontrada");
  const { rows } = await tx.query<{ id: string; active: boolean; max_capacity: number }>(
    `SELECT id, active, max_capacity FROM dining_tables
      WHERE organization_id = $1 AND establishment_id = $2 AND id = ANY($3::uuid[])`,
    [ctx.organizationId, establishmentId, ids],
  );
  if (rows.length !== ids.length) throw new NotFoundError("Mesa no encontrada");
  if (rows.some((r) => !r.active)) throw new ValidationError("Alguna mesa está desactivada");
  const capacity = rows.reduce((s, r) => s + r.max_capacity, 0);
  if (partySize > capacity) {
    throw new ValidationError(`Las mesas elegidas admiten ${capacity} personas y la reserva es de ${partySize}`);
  }
  return ids;
}

async function assignTables(tx: Tx, ctx: TenantContext, establishmentId: string, reservationId: string, tableIds: string[]) {
  await tx.query("DELETE FROM reservation_tables WHERE organization_id = $1 AND reservation_id = $2", [
    ctx.organizationId,
    reservationId,
  ]);
  for (const tableId of tableIds) {
    // `during` y `active` los rellena el trigger desde la reserva.
    await tx.query(
      `INSERT INTO reservation_tables (organization_id, establishment_id, reservation_id, table_id, during, active)
       VALUES ($1, $2, $3, $4, 'empty', false)`,
      [ctx.organizationId, establishmentId, reservationId, tableId],
    );
  }
}

async function establishmentExists(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query("SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  if (rowCount !== 1) throw new NotFoundError();
}

export async function getReservation(tx: Tx, ctx: TenantContext, id: string): Promise<Reservation> {
  requirePermission(ctx, "reservations.read");
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<Reservation>(`${RESERVATION_SQL} WHERE r.organization_id = $1 AND r.id = $2`, [
    ctx.organizationId,
    id,
  ]);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** Reservas que empiezan en la fecha local indicada (zona horaria del establecimiento). */
export async function listReservationsForDay(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  date: string,
): Promise<{ timezone: string; reservations: Reservation[] }> {
  requirePermission(ctx, "reservations.read");
  if (!isValidLocalDate(date)) throw new ValidationError("Fecha no válida");
  await establishmentExists(tx, ctx, establishmentId);
  const est = await tx.query<{ timezone: string }>("SELECT timezone FROM establishments WHERE organization_id = $1 AND id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  const timezone = est.rows[0]!.timezone;
  const from = localToUtc(date, 0, timezone);
  const to = localToUtc(addDays(date, 1), 0, timezone);
  const { rows } = await tx.query<Reservation>(
    `${RESERVATION_SQL}
      WHERE r.organization_id = $1 AND r.establishment_id = $2 AND r.starts_at >= $3 AND r.starts_at < $4
      ORDER BY r.starts_at, r.customer_name`,
    [ctx.organizationId, establishmentId, from, to],
  );
  return { timezone, reservations: rows };
}

/**
 * Mesas activas con capacidad suficiente (individualmente) y sin reservas
 * que se solapen. Orientativo: la garantía real la da la restricción de BD
 * al confirmar.
 */
export async function findAvailableTables(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
  options: { excludeReservationId?: string } = {},
): Promise<{ slot: Slot; tables: AvailableTable[] }> {
  requirePermission(ctx, "reservations.read");
  const d = parseInput(availabilitySchema, input);
  await establishmentExists(tx, ctx, establishmentId);
  const slot = await resolveSlot(tx, ctx, establishmentId, d);
  const { rows } = await tx.query<AvailableTable>(
    `SELECT t.id, t.name, z.name AS "zoneName", t.min_capacity AS "minCapacity", t.max_capacity AS "maxCapacity"
       FROM dining_tables t
       JOIN zones z ON z.organization_id = t.organization_id AND z.id = t.zone_id
      WHERE t.organization_id = $1 AND t.establishment_id = $2 AND t.active
        AND NOT EXISTS (
          SELECT 1 FROM reservation_tables rt
           WHERE rt.organization_id = t.organization_id AND rt.table_id = t.id AND rt.active
             AND rt.during && tstzrange($3, $4, '[)')
             AND ($5::uuid IS NULL OR rt.reservation_id <> $5::uuid))
      ORDER BY (t.max_capacity >= $6) DESC, abs(t.max_capacity - $6), z.position, t.name`,
    [ctx.organizationId, establishmentId, slot.startsAt, slot.endsAt, options.excludeReservationId ?? null, d.partySize],
  );
  return { slot, tables: rows };
}

export async function createReservation(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<{ reservation: Reservation; replayed: boolean }> {
  requirePermission(ctx, "reservations.manage");
  const d = parseInput(reservationSchema, input);
  await establishmentExists(tx, ctx, establishmentId);

  if (d.idempotencyKey) {
    const existing = await tx.query<{ id: string }>(
      "SELECT id FROM reservations WHERE organization_id = $1 AND idempotency_key = $2",
      [ctx.organizationId, d.idempotencyKey],
    );
    if (existing.rows[0]) return { reservation: await getReservation(tx, ctx, existing.rows[0].id), replayed: true };
  }

  const slot = await resolveSlot(tx, ctx, establishmentId, d);
  const tableIds = await checkTables(tx, ctx, establishmentId, d.tableIds, d.partySize);
  try {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO reservations (organization_id, establishment_id, starts_at, ends_at, party_size, status,
                                 customer_name, customer_phone, customer_email, notes, idempotency_key, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [ctx.organizationId, establishmentId, slot.startsAt, slot.endsAt, d.partySize, d.status, d.customerName,
        d.customerPhone ?? null, d.customerEmail ?? null, d.notes ?? null, d.idempotencyKey ?? null, ctx.userId],
    );
    const id = rows[0]!.id;
    await assignTables(tx, ctx, establishmentId, id, tableIds);
    // Sin datos personales en la auditoría.
    await recordAudit(tx, ctx, {
      action: "reservation.created",
      entityType: "reservation",
      entityId: id,
      metadata: { partySize: d.partySize, tables: tableIds.length, status: d.status },
    });
    return { reservation: await getReservation(tx, ctx, id), replayed: false };
  } catch (err) {
    mapReservationError(err);
  }
}

/** Modifica horario, comensales, datos y mesas de una reserva activa. */
export async function updateReservation(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<Reservation> {
  requirePermission(ctx, "reservations.manage");
  const d = parseInput(reservationSchema.omit({ status: true, idempotencyKey: true }), input);
  const current = await lockReservation(tx, ctx, id);
  if (!["pending", "confirmed", "seated"].includes(current.status)) {
    throw new ValidationError("Solo se pueden modificar reservas activas");
  }
  const slot = await resolveSlot(tx, ctx, current.establishment_id, d);
  const tableIds = await checkTables(tx, ctx, current.establishment_id, d.tableIds, d.partySize);
  try {
    await tx.query(
      `UPDATE reservations SET starts_at = $3, ends_at = $4, party_size = $5, customer_name = $6,
              customer_phone = $7, customer_email = $8, notes = $9
        WHERE organization_id = $1 AND id = $2`,
      [ctx.organizationId, id, slot.startsAt, slot.endsAt, d.partySize, d.customerName, d.customerPhone ?? null,
        d.customerEmail ?? null, d.notes ?? null],
    );
    await assignTables(tx, ctx, current.establishment_id, id, tableIds);
  } catch (err) {
    mapReservationError(err);
  }
  await recordAudit(tx, ctx, { action: "reservation.updated", entityType: "reservation", entityId: id });
  return getReservation(tx, ctx, id);
}

async function lockReservation(tx: Tx, ctx: TenantContext, id: string) {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<{ status: ReservationStatus; establishment_id: string }>(
    "SELECT status, establishment_id FROM reservations WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [ctx.organizationId, id],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "pendiente",
  confirmed: "confirmada",
  seated: "en mesa",
  completed: "finalizada",
  cancelled: "cancelada",
  no_show: "no presentada",
};

export async function setReservationStatus(
  tx: Tx,
  ctx: TenantContext,
  id: string,
  status: unknown,
): Promise<Reservation> {
  requirePermission(ctx, "reservations.manage");
  const next = parseInput(z.enum(RESERVATION_STATUSES), status);
  const current = await lockReservation(tx, ctx, id);
  if (!TRANSITIONS[current.status].includes(next)) {
    throw new ValidationError(`Una reserva ${STATUS_LABEL[current.status]} no puede pasar a ${STATUS_LABEL[next]}`);
  }
  try {
    // Al finalizar antes de tiempo se acorta la reserva para liberar la mesa desde ahora.
    if (next === "completed") {
      await tx.query(
        `UPDATE reservations SET status = $3, ends_at = LEAST(ends_at, GREATEST(now(), starts_at + interval '1 minute'))
          WHERE organization_id = $1 AND id = $2`,
        [ctx.organizationId, id, next],
      );
    } else {
      await tx.query("UPDATE reservations SET status = $3 WHERE organization_id = $1 AND id = $2", [
        ctx.organizationId,
        id,
        next,
      ]);
    }
  } catch (err) {
    mapReservationError(err);
  }
  await recordAudit(tx, ctx, {
    action: "reservation.status_changed",
    entityType: "reservation",
    entityId: id,
    metadata: { from: current.status, to: next },
  });
  return getReservation(tx, ctx, id);
}

/** Mesas ocupadas en un instante (para pintar la ocupación sobre el plano). */
export async function occupancyAt(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  instant: Date,
): Promise<Map<string, { reservationId: string; customerName: string; partySize: number; status: ReservationStatus }>> {
  requirePermission(ctx, "reservations.read");
  await establishmentExists(tx, ctx, establishmentId);
  const { rows } = await tx.query<{ table_id: string; id: string; customer_name: string; party_size: number; status: ReservationStatus }>(
    `SELECT rt.table_id, r.id, r.customer_name, r.party_size, r.status
       FROM reservation_tables rt
       JOIN reservations r ON r.organization_id = rt.organization_id AND r.id = rt.reservation_id
      WHERE rt.organization_id = $1 AND rt.establishment_id = $2 AND rt.active AND rt.during @> $3::timestamptz`,
    [ctx.organizationId, establishmentId, instant],
  );
  return new Map(
    rows.map((r) => [r.table_id, { reservationId: r.id, customerName: r.customer_name, partySize: r.party_size, status: r.status }]),
  );
}
