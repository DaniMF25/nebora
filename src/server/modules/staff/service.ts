import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/pool";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  addDays,
  isoWeekday,
  isValidLocalDate,
  localDateOf,
  localToUtc,
  parseTime,
} from "@/server/modules/schedules/time";
import { requirePermission, type TenantContext } from "@/server/tenancy/context";
import { isUuid, parseInput } from "@/server/validation";

// Personal y cuadrante de turnos (migración 0030, D-045).

export interface StaffMember {
  id: string;
  name: string;
  position: string | null;
  active: boolean;
  /** Cuenta de Nébora vinculada (miembro de la organización), si la hay. */
  userId: string | null;
  userName: string | null;
}

export interface Shift {
  id: string;
  staffMemberId: string;
  establishmentId: string;
  startsAt: Date;
  endsAt: Date;
  /** Día local en que empieza, horas locales «HH:MM» y duración. */
  date: string;
  start: string;
  end: string;
  minutes: number;
  position: string | null;
  notes: string | null;
}

export interface WeekRota {
  weekStart: string;
  days: string[];
  shifts: Shift[];
  /** Minutos por persona en la semana (solo turnos de este local). */
  minutesByMember: Record<string, number>;
}

/** Duración máxima de un turno (también lo limita la BD). */
export const MAX_SHIFT_MINUTES = 16 * 60;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const memberFields = {
  name: z.string().trim().min(1, "Indica el nombre").max(80),
  position: optionalText(40),
  userId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || isUuid(v), { message: "Cuenta no válida" })
    .nullable()
    .optional(),
};

export const createStaffMemberSchema = z.object(memberFields).strict();
export const updateStaffMemberSchema = z.object({ ...memberFields, active: z.boolean() }).strict();

const timeSchema = z.string().refine((v) => parseTime(v) !== null, { message: "Hora no válida (HH:MM)" });

export const shiftSchema = z
  .object({
    staffMemberId: z.string().refine(isUuid, { message: "Elige a una persona" }),
    date: z.string().refine(isValidLocalDate, { message: "Fecha no válida" }),
    start: timeSchema,
    end: timeSchema,
    position: optionalText(40),
    notes: optionalText(200),
  })
  .strict()
  .refine((s) => s.start !== s.end, { message: "La hora de fin debe ser distinta de la de inicio", path: ["end"] });

function mapStaffError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23P01" && e.constraint === "staff_shifts_no_overlap") {
    throw new ConflictError("Esa persona ya tiene un turno que se solapa con ese horario");
  }
  if (e.code === "23505" && e.constraint === "staff_members_user_unique") {
    throw new ConflictError("Esa cuenta ya está vinculada a otra ficha");
  }
  if (e.code === "23503" && e.constraint === "staff_shifts_member_fk") {
    throw new ConflictError("Tiene turnos: desactívala en lugar de eliminarla");
  }
  if (e.code === "23514" && e.constraint === "staff_shifts_time_check") {
    throw new ValidationError(`Un turno dura como máximo ${MAX_SHIFT_MINUTES / 60} horas`);
  }
  throw err;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapStaffError(err);
  }
}

// ---------------------------------------------------------------------------
// Fichas del personal

const MEMBER_SQL = `
  SELECT s.id, s.name, s.position, s.active, s.user_id AS "userId", u.display_name AS "userName"
    FROM staff_members s LEFT JOIN users u ON u.id = s.user_id`;

export async function listStaffMembers(
  tx: Tx,
  ctx: TenantContext,
  options: { includeInactive?: boolean } = {},
): Promise<StaffMember[]> {
  requirePermission(ctx, "staff.read");
  const { rows } = await tx.query<StaffMember>(
    `${MEMBER_SQL} WHERE s.organization_id = $1 AND ($2 OR s.active) ORDER BY s.active DESC, s.name, s.id`,
    [ctx.organizationId, options.includeInactive ?? false],
  );
  return rows;
}

async function getMember(tx: Tx, ctx: TenantContext, id: string, lock = false): Promise<StaffMember> {
  if (!isUuid(id)) throw new NotFoundError();
  const { rows } = await tx.query<StaffMember>(
    `${MEMBER_SQL} WHERE s.organization_id = $1 AND s.id = $2${lock ? " FOR UPDATE OF s" : ""}`,
    [ctx.organizationId, id],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** La cuenta vinculada debe ser de un miembro activo de esta organización. */
async function checkLinkedUser(tx: Tx, ctx: TenantContext, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const { rowCount } = await tx.query(
    "SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [ctx.organizationId, userId],
  );
  if (rowCount !== 1)
    throw new ValidationError("Esa cuenta no es de un miembro de la organización", { userId: ["Elige un miembro"] });
}

export async function createStaffMember(tx: Tx, ctx: TenantContext, input: unknown): Promise<StaffMember> {
  requirePermission(ctx, "staff.manage");
  const data = parseInput(createStaffMemberSchema, input);
  await checkLinkedUser(tx, ctx, data.userId);
  const { rows } = await attempt(() =>
    tx.query<{ id: string }>(
      "INSERT INTO staff_members (organization_id, name, position, user_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [ctx.organizationId, data.name, data.position ?? null, data.userId ?? null],
    ),
  );
  const id = rows[0]!.id;
  await recordAudit(tx, ctx, { action: "staff.member_created", entityType: "staff_member", entityId: id });
  return getMember(tx, ctx, id);
}

export async function updateStaffMember(tx: Tx, ctx: TenantContext, id: string, input: unknown): Promise<StaffMember> {
  requirePermission(ctx, "staff.manage");
  const current = await getMember(tx, ctx, id, true);
  const data = parseInput(updateStaffMemberSchema, input);
  // Sin `userId` se conserva el vínculo; la cuenta solo se valida si cambia
  // (un miembro suspendido sigue vinculado a su ficha).
  const userId = data.userId === undefined ? current.userId : data.userId;
  if (userId !== current.userId) await checkLinkedUser(tx, ctx, userId);
  await attempt(() =>
    tx.query(
      `UPDATE staff_members SET name = $3, position = $4, user_id = $5, active = $6
        WHERE organization_id = $1 AND id = $2`,
      [ctx.organizationId, id, data.name, data.position ?? null, userId, data.active],
    ),
  );
  await recordAudit(tx, ctx, {
    action: "staff.member_updated",
    entityType: "staff_member",
    entityId: id,
    metadata: { active: data.active },
  });
  return getMember(tx, ctx, id);
}

/** Solo se elimina una ficha sin turnos (en cualquier local); si no, se desactiva. */
export async function deleteStaffMember(tx: Tx, ctx: TenantContext, id: string): Promise<void> {
  requirePermission(ctx, "staff.manage");
  await getMember(tx, ctx, id, true);
  // RLS oculta los turnos de locales a los que no se accede: la FK los ve todos.
  await attempt(() =>
    tx.query("DELETE FROM staff_members WHERE organization_id = $1 AND id = $2", [ctx.organizationId, id]),
  );
  await recordAudit(tx, ctx, { action: "staff.member_deleted", entityType: "staff_member", entityId: id });
}

// ---------------------------------------------------------------------------
// Turnos

async function establishmentTimezone(tx: Tx, ctx: TenantContext, establishmentId: string): Promise<string> {
  if (!isUuid(establishmentId)) throw new NotFoundError();
  const { rows } = await tx.query<{ timezone: string }>(
    "SELECT timezone FROM establishments WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, establishmentId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0].timezone;
}

/** Lunes (fecha local) de la semana de `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Instantes de un turno a partir de su día local y sus horas; si acaba antes de empezar, acaba al día siguiente. */
export function shiftInterval(
  date: string,
  start: string,
  end: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const s = parseTime(start)!;
  let e = parseTime(end)!;
  if (e <= s) e += 1440;
  return { startsAt: localToUtc(date, s, timeZone), endsAt: localToUtc(date, e, timeZone) };
}

function hhmm(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    instant,
  );
}

type ShiftRow = Omit<Shift, "date" | "start" | "end" | "minutes">;

function toShift(r: ShiftRow, timeZone: string): Shift {
  return {
    ...r,
    date: localDateOf(r.startsAt, timeZone),
    start: hhmm(r.startsAt, timeZone),
    end: hhmm(r.endsAt, timeZone),
    minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
  };
}

const SHIFT_SQL = `
  SELECT id, staff_member_id AS "staffMemberId", establishment_id AS "establishmentId", starts_at AS "startsAt",
         ends_at AS "endsAt", position, notes
    FROM staff_shifts`;

export async function getWeekRota(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  date: string,
): Promise<WeekRota> {
  requirePermission(ctx, "staff.read");
  const tz = await establishmentTimezone(tx, ctx, establishmentId);
  if (!isValidLocalDate(date)) throw new ValidationError("Fecha no válida");
  const weekStart = weekStartOf(date);
  const { rows } = await tx.query<ShiftRow>(
    `${SHIFT_SQL}
      WHERE organization_id = $1 AND establishment_id = $2 AND starts_at >= $3 AND starts_at < $4
      ORDER BY starts_at, id`,
    [ctx.organizationId, establishmentId, localToUtc(weekStart, 0, tz), localToUtc(addDays(weekStart, 7), 0, tz)],
  );
  const shifts = rows.map((r) => toShift(r, tz));
  const minutesByMember: Record<string, number> = {};
  for (const s of shifts) minutesByMember[s.staffMemberId] = (minutesByMember[s.staffMemberId] ?? 0) + s.minutes;
  return { weekStart, days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), shifts, minutesByMember };
}

async function requireActiveMember(tx: Tx, ctx: TenantContext, staffMemberId: string): Promise<void> {
  const { rows } = await tx.query<{ active: boolean }>(
    "SELECT active FROM staff_members WHERE organization_id = $1 AND id = $2",
    [ctx.organizationId, staffMemberId],
  );
  if (!rows[0]) throw new ValidationError("Elige a una persona", { staffMemberId: ["Elige a una persona"] });
  if (!rows[0].active)
    throw new ValidationError("Esa persona está desactivada", { staffMemberId: ["Está desactivada"] });
}

function parseShift(input: unknown, tz: string) {
  const data = parseInput(shiftSchema, input);
  const { startsAt, endsAt } = shiftInterval(data.date, data.start, data.end, tz);
  if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_MINUTES * 60000) {
    throw new ValidationError(`Un turno dura como máximo ${MAX_SHIFT_MINUTES / 60} horas`, {
      end: ["Turno demasiado largo"],
    });
  }
  return { ...data, startsAt, endsAt };
}

export async function createShift(tx: Tx, ctx: TenantContext, establishmentId: string, input: unknown): Promise<Shift> {
  requirePermission(ctx, "staff.manage");
  const tz = await establishmentTimezone(tx, ctx, establishmentId);
  const s = parseShift(input, tz);
  await requireActiveMember(tx, ctx, s.staffMemberId);
  const { rows } = await attempt(() =>
    tx.query<ShiftRow>(
      `INSERT INTO staff_shifts (organization_id, establishment_id, staff_member_id, starts_at, ends_at, position, notes,
                                 created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, staff_member_id AS "staffMemberId", establishment_id AS "establishmentId",
                 starts_at AS "startsAt", ends_at AS "endsAt", position, notes`,
      [
        ctx.organizationId,
        establishmentId,
        s.staffMemberId,
        s.startsAt,
        s.endsAt,
        s.position ?? null,
        s.notes ?? null,
        ctx.userId,
      ],
    ),
  );
  const shift = toShift(rows[0]!, tz);
  await recordAudit(tx, ctx, {
    action: "staff.shift_created",
    entityType: "staff_shift",
    entityId: shift.id,
    metadata: { establishmentId, staffMemberId: s.staffMemberId },
  });
  return shift;
}

async function getShift(tx: Tx, ctx: TenantContext, establishmentId: string, shiftId: string): Promise<ShiftRow> {
  if (!isUuid(shiftId)) throw new NotFoundError();
  const { rows } = await tx.query<ShiftRow>(
    `${SHIFT_SQL} WHERE organization_id = $1 AND establishment_id = $2 AND id = $3 FOR UPDATE`,
    [ctx.organizationId, establishmentId, shiftId],
  );
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateShift(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  shiftId: string,
  input: unknown,
): Promise<Shift> {
  requirePermission(ctx, "staff.manage");
  const tz = await establishmentTimezone(tx, ctx, establishmentId);
  const current = await getShift(tx, ctx, establishmentId, shiftId);
  const s = parseShift(input, tz);
  if (s.staffMemberId !== current.staffMemberId) await requireActiveMember(tx, ctx, s.staffMemberId);
  const { rows } = await attempt(() =>
    tx.query<ShiftRow>(
      `UPDATE staff_shifts SET staff_member_id = $4, starts_at = $5, ends_at = $6, position = $7, notes = $8
        WHERE organization_id = $1 AND establishment_id = $2 AND id = $3
        RETURNING id, staff_member_id AS "staffMemberId", establishment_id AS "establishmentId",
                  starts_at AS "startsAt", ends_at AS "endsAt", position, notes`,
      [
        ctx.organizationId,
        establishmentId,
        shiftId,
        s.staffMemberId,
        s.startsAt,
        s.endsAt,
        s.position ?? null,
        s.notes ?? null,
      ],
    ),
  );
  await recordAudit(tx, ctx, {
    action: "staff.shift_updated",
    entityType: "staff_shift",
    entityId: shiftId,
    metadata: { establishmentId, staffMemberId: s.staffMemberId },
  });
  return toShift(rows[0]!, tz);
}

export async function deleteShift(tx: Tx, ctx: TenantContext, establishmentId: string, shiftId: string): Promise<void> {
  requirePermission(ctx, "staff.manage");
  await establishmentTimezone(tx, ctx, establishmentId);
  const current = await getShift(tx, ctx, establishmentId, shiftId);
  await tx.query("DELETE FROM staff_shifts WHERE organization_id = $1 AND id = $2", [ctx.organizationId, shiftId]);
  await recordAudit(tx, ctx, {
    action: "staff.shift_deleted",
    entityType: "staff_shift",
    entityId: shiftId,
    metadata: { establishmentId, staffMemberId: current.staffMemberId },
  });
}

/**
 * Copia los turnos de la semana anterior en la semana de `date`, con las
 * mismas horas locales. Se saltan los de personas desactivadas y los que se
 * solaparían con un turno ya existente (en cualquier local).
 */
export async function copyPreviousWeek(
  tx: Tx,
  ctx: TenantContext,
  establishmentId: string,
  date: string,
): Promise<{ copied: number; skipped: number }> {
  requirePermission(ctx, "staff.manage");
  const tz = await establishmentTimezone(tx, ctx, establishmentId);
  if (!isValidLocalDate(date)) throw new ValidationError("Fecha no válida");
  // Serializa las copias del local: dos clics seguidos no duplican la semana.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('staff-copy:' || $1::text, 0))", [establishmentId]);
  const previous = await getWeekRota(tx, ctx, establishmentId, addDays(weekStartOf(date), -7));
  const { rows: activeRows } = await tx.query<{ id: string }>(
    "SELECT id FROM staff_members WHERE organization_id = $1 AND active",
    [ctx.organizationId],
  );
  const active = new Set(activeRows.map((r) => r.id));
  let copied = 0;
  let skipped = 0;
  for (const s of previous.shifts) {
    if (!active.has(s.staffMemberId)) {
      skipped++;
      continue;
    }
    const { startsAt, endsAt } = shiftInterval(addDays(s.date, 7), s.start, s.end, tz);
    await tx.query("SAVEPOINT staff_copy");
    try {
      await tx.query(
        `INSERT INTO staff_shifts (organization_id, establishment_id, staff_member_id, starts_at, ends_at, position, notes,
                                   created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.organizationId, establishmentId, s.staffMemberId, startsAt, endsAt, s.position, s.notes, ctx.userId],
      );
      await tx.query("RELEASE SAVEPOINT staff_copy");
      copied++;
    } catch (err) {
      await tx.query("ROLLBACK TO SAVEPOINT staff_copy");
      const e = err as { code?: string; constraint?: string };
      if (e.code === "23P01" && e.constraint === "staff_shifts_no_overlap") {
        skipped++;
        continue;
      }
      throw err;
    }
  }
  await recordAudit(tx, ctx, {
    action: "staff.week_copied",
    entityType: "establishment",
    entityId: establishmentId,
    metadata: { weekStart: weekStartOf(date), copied, skipped },
  });
  return { copied, skipped };
}
