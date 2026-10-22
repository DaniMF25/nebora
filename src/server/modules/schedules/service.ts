import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { NotFoundError, ValidationError } from "@/server/errors";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";
import {
  isValidLocalDate,
  slotFromTimes,
  validateDaySlots,
  validateWeeklySlots,
  type DateException,
  type Schedule,
  type Slot,
  type WeeklySlot,
} from "./time";

const timeRangeSchema = z
  .object({ opens: z.string(), closes: z.string() })
  .strict()
  .transform((v, ctx) => {
    const slot = slotFromTimes(v.opens, v.closes);
    if (!slot) {
      ctx.addIssue({ code: "custom", message: "Horario no válido (usa HH:MM; apertura y cierre distintos)" });
      return z.NEVER;
    }
    return slot;
  });

export const weeklyHoursSchema = z
  .object({
    slots: z
      .array(z.object({ weekday: z.number().int().min(1).max(7), opens: z.string(), closes: z.string() }).strict())
      .max(42),
  })
  .strict();

const localDateSchema = z.string().refine(isValidLocalDate, { message: "Fecha no válida (AAAA-MM-DD)" });

export const dateExceptionSchema = z
  .object({
    date: localDateSchema,
    closed: z.boolean(),
    slots: z.array(timeRangeSchema).max(6).default([]),
    note: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => (v.closed ? v.slots.length === 0 : v.slots.length > 0), {
    message: "Indica turnos o marca el día como cerrado (no ambos)",
    path: ["slots"],
  });

export interface EstablishmentSchedule extends Schedule {
  establishmentId: string;
  timezone: string;
}

/** Bloquea el establecimiento (serializa cambios de horario) y verifica que es de la organización. */
async function lockEstablishment(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<void> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rowCount } = await tx.query(
    "SELECT 1 FROM establishments WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [ctx.organizationId, establishmentId],
  );
  if (rowCount !== 1) throw new NotFoundError();
}

export async function getSchedule(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  options: { exceptionsFrom?: string } = {},
): Promise<EstablishmentSchedule> {
  requirePermission(ctx, "establishments.read");
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const est = await tx.query<{ timezone: string }>(
    "SELECT timezone FROM establishments WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, establishmentId],
  );
  if (!est.rows[0]) throw new NotFoundError();

  const weekly = await tx.query<WeeklySlot>(
    `SELECT weekday, opens_minute AS "opensMinute", duration_minutes AS "durationMinutes"
       FROM opening_hours WHERE organization_id = $1 AND establishment_id = $2
      ORDER BY weekday, opens_minute`,
    [ctx.organizationId, establishmentId],
  );
  const exceptions = await tx.query<{
    id: string;
    date: string;
    closed: boolean;
    note: string | null;
    slots: Slot[] | null;
  }>(
    `SELECT e.id, to_char(e.date, 'YYYY-MM-DD') AS date, e.closed, e.note,
            (SELECT json_agg(json_build_object('opensMinute', s.opens_minute, 'durationMinutes', s.duration_minutes)
                             ORDER BY s.opens_minute)
               FROM schedule_exception_slots s
              WHERE s.organization_id = e.organization_id AND s.exception_id = e.id) AS slots
       FROM schedule_exceptions e
      WHERE e.organization_id = $1 AND e.establishment_id = $2
        AND ($3::date IS NULL OR e.date >= $3::date)
      ORDER BY e.date`,
    [ctx.organizationId, establishmentId, options.exceptionsFrom ?? null],
  );
  return {
    establishmentId,
    timezone: est.rows[0].timezone,
    weekly: weekly.rows,
    exceptions: exceptions.rows.map(
      (r): DateException => ({ date: r.date, closed: r.closed, note: r.note, slots: r.slots ?? [] }),
    ),
  };
}

/** Sustituye el horario semanal completo de forma atómica. */
export async function setWeeklyHours(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  const { slots } = parseInput(weeklyHoursSchema, input);
  const weekly: WeeklySlot[] = slots.map((s) => {
    const slot = slotFromTimes(s.opens, s.closes);
    if (!slot) throw new ValidationError("Horario no válido (usa HH:MM; apertura y cierre distintos)");
    return { weekday: s.weekday, ...slot };
  });
  const problem = validateWeeklySlots(weekly);
  if (problem) throw new ValidationError(problem);

  await lockEstablishment(tx, ctx, establishmentId);
  await tx.query("DELETE FROM opening_hours WHERE organization_id = $1 AND establishment_id = $2", [
    ctx.organizationId,
    establishmentId,
  ]);
  for (const s of weekly) {
    await tx.query(
      `INSERT INTO opening_hours (organization_id, establishment_id, weekday, opens_minute, duration_minutes)
       VALUES ($1, $2, $3, $4, $5)`,
      [ctx.organizationId, establishmentId, s.weekday, s.opensMinute, s.durationMinutes],
    );
  }
  await recordAudit(tx, ctx, {
    action: "schedule.weekly_updated",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { slots: weekly.length },
  });
}

/** Crea o sustituye la excepción de una fecha local. */
export async function setDateException(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  input: unknown,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  const data = parseInput(dateExceptionSchema, input);
  const problem = validateDaySlots(data.slots);
  if (problem) throw new ValidationError(problem);

  await lockEstablishment(tx, ctx, establishmentId);
  await tx.query(
    "DELETE FROM schedule_exceptions WHERE organization_id = $1 AND establishment_id = $2 AND date = $3",
    [ctx.organizationId, establishmentId, data.date],
  );
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO schedule_exceptions (organization_id, establishment_id, date, closed, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [ctx.organizationId, establishmentId, data.date, data.closed, data.note ?? null],
  );
  const exceptionId = rows[0]!.id;
  for (const s of data.slots) {
    await tx.query(
      `INSERT INTO schedule_exception_slots (organization_id, exception_id, opens_minute, duration_minutes)
       VALUES ($1, $2, $3, $4)`,
      [ctx.organizationId, exceptionId, s.opensMinute, s.durationMinutes],
    );
  }
  await recordAudit(tx, ctx, {
    action: "schedule.exception_set",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { date: data.date, closed: data.closed },
  });
}

export async function deleteDateException(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  date: string,
): Promise<void> {
  requirePermission(ctx, "establishments.update");
  if (!isValidLocalDate(date)) throw new NotFoundError();
  await lockEstablishment(tx, ctx, establishmentId);
  const res = await tx.query(
    "DELETE FROM schedule_exceptions WHERE organization_id = $1 AND establishment_id = $2 AND date = $3",
    [ctx.organizationId, establishmentId, date],
  );
  if (res.rowCount !== 1) throw new NotFoundError();
  await recordAudit(tx, ctx, {
    action: "schedule.exception_deleted",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { date },
  });
}
