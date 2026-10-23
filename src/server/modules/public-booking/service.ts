import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getPool, isUniqueViolation, withTransaction, type Tx } from "@/server/db/pool";

type Queryable = Pick<Tx, "query">;
import { ConflictError, RateLimitedError, ValidationError } from "@/server/errors";
import {
  addDays,
  isValidLocalDate,
  localDateOf,
  localToUtc,
  parseTime,
  resolveOpeningIntervals,
  type Schedule,
  type Slot,
} from "@/server/modules/schedules/time";
import { parseInput } from "@/server/validation";
import { availableStarts, freeTables, rankTables, type Busy, type TableCapacity } from "./slots";

export interface PublicBookingInfo {
  establishmentId: string;
  establishmentName: string;
  organizationName: string;
  timezone: string;
  minParty: number;
  maxParty: number;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
}

/** Límites de peticiones de alta pública. */
export const PUBLIC_RATE_LIMITS = {
  perClientPerHour: 10,
  perEstablishmentPerHour: 200,
  perContactPerDay: 5,
};

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Datos públicos del local si tiene la reserva pública activada; null si no. */
export async function getPublicBookingInfo(orgSlug: string, establishmentSlug: string): Promise<PublicBookingInfo | null> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => slugPattern.test(s))) return null;
  const { rows } = await getPool().query<{
    establishment_id: string;
    establishment_name: string;
    organization_name: string;
    timezone: string;
    min_party: number;
    max_party: number;
    duration_minutes: number;
    slot_interval_minutes: number;
    min_notice_minutes: number;
    max_days_ahead: number;
    auto_confirm: boolean;
  }>("SELECT * FROM app.public_booking_info($1, $2)", slugs);
  const r = rows[0];
  if (!r) return null;
  return {
    establishmentId: r.establishment_id,
    establishmentName: r.establishment_name,
    organizationName: r.organization_name,
    timezone: r.timezone,
    minParty: r.min_party,
    maxParty: r.max_party,
    durationMinutes: r.duration_minutes,
    slotIntervalMinutes: r.slot_interval_minutes,
    minNoticeMinutes: r.min_notice_minutes,
    maxDaysAhead: r.max_days_ahead,
    autoConfirm: r.auto_confirm,
  };
}

/** Fechas reservables: desde hoy hasta el límite de días vista (fecha local). */
export function bookableDateRange(info: PublicBookingInfo, now = new Date()): { first: string; last: string } {
  const first = localDateOf(now, info.timezone);
  return { first, last: addDays(first, info.maxDaysAhead) };
}

async function loadAvailability(q: Queryable, info: PublicBookingInfo, date: string) {
  const weekly = await q.query<{ weekday: number; opens_minute: number; duration_minutes: number }>(
    "SELECT * FROM app.public_opening_hours($1)",
    [info.establishmentId],
  );
  const exceptions = await q.query<{ date: string; closed: boolean; slots: Slot[] }>(
    "SELECT * FROM app.public_schedule_exceptions($1, $2::date, $3::date)",
    [info.establishmentId, addDays(date, -1), addDays(date, 1)],
  );
  const schedule: Schedule = {
    weekly: weekly.rows.map((w) => ({ weekday: w.weekday, opensMinute: w.opens_minute, durationMinutes: w.duration_minutes })),
    exceptions: exceptions.rows.map((e) => ({ date: e.date, closed: e.closed, slots: e.slots })),
  };
  const dayStart = localToUtc(date, 0, info.timezone).getTime();
  const dayEnd = localToUtc(addDays(date, 1), 0, info.timezone).getTime();
  const durationMs = info.durationMinutes * 60_000;
  const tables = await q.query<{ id: string; min_capacity: number; max_capacity: number }>(
    "SELECT * FROM app.public_tables($1)",
    [info.establishmentId],
  );
  const busy = await q.query<{ table_id: string; starts_at: Date; ends_at: Date }>(
    "SELECT * FROM app.public_busy($1, $2, $3)",
    [info.establishmentId, new Date(dayStart - 24 * 3_600_000), new Date(dayEnd + durationMs)],
  );
  return {
    intervals: resolveOpeningIntervals(schedule, info.timezone, date, 1).map((iv) => ({
      start: iv.start.getTime(),
      end: iv.end.getTime(),
    })),
    dayStart,
    dayEnd,
    durationMs,
    tables: tables.rows.map((t): TableCapacity => ({ id: t.id, minCapacity: t.min_capacity, maxCapacity: t.max_capacity })),
    busy: busy.rows.map((b): Busy => ({ tableId: b.table_id, start: b.starts_at.getTime(), end: b.ends_at.getTime() })),
  };
}

function hhmm(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}

function partyAllowed(info: PublicBookingInfo, party: number): boolean {
  return Number.isInteger(party) && party >= info.minParty && party <= info.maxParty;
}

/** Horas disponibles (HH:MM locales) para una fecha y un número de comensales. */
export async function listPublicSlots(
  info: PublicBookingInfo,
  date: string,
  party: number,
  now = new Date(),
): Promise<{ slots: string[]; starts: number[] }> {
  const range = bookableDateRange(info, now);
  if (!isValidLocalDate(date) || date < range.first || date > range.last || !partyAllowed(info, party)) {
    return { slots: [], starts: [] };
  }
  const a = await loadAvailability(getPool(), info, date);
  const starts = availableStarts({
    ...a,
    stepMs: info.slotIntervalMinutes * 60_000,
    earliest: now.getTime() + info.minNoticeMinutes * 60_000,
    latest: now.getTime() + (info.maxDaysAhead + 1) * 86_400_000,
    party,
  });
  return { starts, slots: starts.map((s) => hhmm(s, info.timezone)) };
}

export const publicBookingSchema = z
  .object({
    date: z.string().refine(isValidLocalDate, { message: "Fecha no válida" }),
    time: z.string().refine((v) => parseTime(v) !== null, { message: "Elige una hora" }),
    partySize: z.number().int().min(1).max(50),
    customerName: z.string().trim().min(1, "Indica tu nombre").max(120),
    customerPhone: z.string().trim().max(40).regex(/^[+0-9 ()-]*$/, { message: "Teléfono no válido" }),
    customerEmail: z
      .string()
      .trim()
      .max(254)
      .refine((v) => v === "" || z.email().safeParse(v).success, { message: "Correo no válido" }),
    notes: z.string().trim().max(300),
    consent: z.literal(true, { message: "Debes aceptar el tratamiento de datos para gestionar la reserva" }),
    // Campo trampa: invisible para personas; los bots suelen rellenarlo.
    website: z.string().max(0, { message: "No se pudo procesar la solicitud" }),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  })
  .strict()
  .refine((v) => v.customerPhone !== "" || v.customerEmail !== "", {
    message: "Indica un teléfono o un correo para poder contactarte",
    path: ["customerPhone"],
  });

const PUBLIC_ERRORS: Record<string, () => Error> = {
  public_booking_disabled: () => new ValidationError("Este establecimiento no acepta reservas online"),
  party_out_of_range: () => new ValidationError("Número de comensales no admitido online"),
  invalid_duration: () => new ValidationError("Duración no válida"),
  outside_booking_window: () => new ValidationError("Esa hora ya no se puede reservar online"),
  no_availability: () => new ConflictError("Esa hora acaba de completarse. Elige otra, por favor."),
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Registra el intento en cada límite; lanza RateLimitedError si se supera alguno. */
async function enforceRateLimits(info: PublicBookingInfo, clientId: string, contact: string): Promise<void> {
  const checks: [string, number, number][] = [
    [`pb:client:${hash(clientId)}`, 3600, PUBLIC_RATE_LIMITS.perClientPerHour],
    [`pb:est:${info.establishmentId}`, 3600, PUBLIC_RATE_LIMITS.perEstablishmentPerHour],
    [`pb:contact:${info.establishmentId}:${hash(contact.toLowerCase())}`, 86_400, PUBLIC_RATE_LIMITS.perContactPerDay],
  ];
  // Transacción propia: los intentos cuentan aunque la reserva falle después.
  await withTransaction(async (tx) => {
    for (const [bucket, windowSeconds, max] of checks) {
      const { rows } = await tx.query<{ ok: boolean }>("SELECT app.rate_limit_hit($1, $2, $3) AS ok", [
        bucket,
        windowSeconds,
        max,
      ]);
      if (!rows[0]!.ok) throw new RateLimitedError("Demasiadas solicitudes. Inténtalo más tarde o llama al restaurante.");
    }
  });
}

export interface PublicBookingResult {
  code: string;
  status: "confirmed" | "pending";
  startsAt: Date;
  partySize: number;
  replayed: boolean;
}

/**
 * Alta pública: valida, limita, recalcula que la hora sigue disponible y
 * delega la creación en app.public_book (reglas y exclusión en BD).
 * `clientId` identifica al cliente para el límite (p. ej. su IP); solo se
 * guarda su hash.
 */
export async function bookPublic(
  info: PublicBookingInfo,
  input: unknown,
  clientId: string,
  now = new Date(),
): Promise<PublicBookingResult> {
  const d = parseInput(publicBookingSchema, input);
  if (!partyAllowed(info, d.partySize)) {
    throw new ValidationError(`Online se admiten de ${info.minParty} a ${info.maxParty} comensales`);
  }

  // Reenvío del mismo formulario: se devuelve la reserva ya creada.
  const existing = await getPool().query<{ public_code: string; status: "confirmed" | "pending"; starts_at: Date; party_size: number }>(
    "SELECT * FROM app.public_booking_by_key($1, $2)",
    [info.establishmentId, d.idempotencyKey],
  );
  if (existing.rows[0]) {
    const r = existing.rows[0];
    return { code: r.public_code, status: r.status, startsAt: r.starts_at, partySize: r.party_size, replayed: true };
  }

  await enforceRateLimits(info, clientId, d.customerEmail || d.customerPhone);

  const { starts } = await listPublicSlots(info, d.date, d.partySize, now);
  const start = localToUtc(d.date, parseTime(d.time)!, info.timezone).getTime();
  if (!starts.includes(start)) throw new ConflictError("Esa hora ya no está disponible. Elige otra, por favor.");

  return withTransaction(async (tx) => {
    const a = await loadAvailability(tx, info, d.date);
    const end = start + a.durationMs;
    const candidates = freeTables(rankTables(a.tables, d.partySize), a.busy, start, end).map((t) => t.id);
    try {
      const { rows } = await tx.query<{ public_code: string; status: "confirmed" | "pending"; replayed: boolean }>(
        "SELECT * FROM app.public_book($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10)",
        [
          info.establishmentId,
          new Date(start),
          new Date(end),
          d.partySize,
          d.customerName,
          d.customerPhone || null,
          d.customerEmail ? d.customerEmail.toLowerCase() : null,
          d.notes || null,
          candidates,
          d.idempotencyKey,
        ],
      );
      const r = rows[0]!;
      return { code: r.public_code, status: r.status, startsAt: new Date(start), partySize: d.partySize, replayed: r.replayed };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "P0001" && e.message && PUBLIC_ERRORS[e.message]) throw PUBLIC_ERRORS[e.message]!();
      if (isUniqueViolation(err, "reservations_idempotency_unique")) {
        throw new ConflictError("Tu solicitud ya se está procesando. Revisa en unos segundos.");
      }
      throw err;
    }
  });
}
