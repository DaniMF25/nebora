import "server-only";
import { createHash, randomBytes } from "node:crypto";
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
import type { Language } from "@/lib/languages";

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
  /** Días que se conservan los datos del cliente tras la reserva. */
  customerRetentionDays: number;
  /** Idiomas adicionales del local para la página de reserva (D-040). */
  languages: Language[];
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
    customer_retention_days: number;
    languages: Language[];
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
    customerRetentionDays: r.customer_retention_days,
    languages: r.languages,
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
  /**
   * Token del enlace de cancelación (D-041). Solo se guarda su huella; un
   * reenvío del mismo formulario genera uno nuevo y el anterior deja de valer.
   */
  cancelToken: string;
}

/**
 * Alta pública: valida, limita, recalcula que la hora sigue disponible y
 * delega la creación en app.public_book (reglas y exclusión en BD).
 * `clientId` identifica al cliente para el límite (p. ej. su IP); solo se
 * guarda su hash.
 */
async function bookPublicReservation(
  info: PublicBookingInfo,
  input: unknown,
  clientId: string,
  now = new Date(),
): Promise<Omit<PublicBookingResult, "cancelToken">> {
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

// ---------------------------------------------------------------------------
// Cancelación por el cliente (D-041)
// ---------------------------------------------------------------------------

const CANCEL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Crea la reserva online y le asigna un token de cancelación nuevo. */
export async function bookPublic(
  info: PublicBookingInfo,
  input: unknown,
  clientId: string,
  now = new Date(),
): Promise<PublicBookingResult> {
  const result = await bookPublicReservation(info, input, clientId, now);
  const cancelToken = randomBytes(32).toString("base64url");
  const key = (input as { idempotencyKey: string }).idempotencyKey;
  await getPool().query("SELECT app.public_set_cancel_token($1, $2, $3)", [
    info.establishmentId,
    key,
    tokenHash(cancelToken),
  ]);
  return { ...result, cancelToken };
}

export interface PublicCancellation {
  code: string;
  startsAt: Date;
  partySize: number;
  status: string;
  timezone: string;
}

/** Reserva del enlace de cancelación, o null si el token no es de ese local. */
export async function getPublicCancellation(
  orgSlug: string,
  establishmentSlug: string,
  token: string,
): Promise<PublicCancellation | null> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => slugPattern.test(s)) || !CANCEL_TOKEN.test(token)) return null;
  const { rows } = await getPool().query<{
    public_code: string;
    starts_at: Date;
    party_size: number;
    status: string;
    timezone: string;
  }>("SELECT * FROM app.public_cancellation($1, $2, $3)", [...slugs, tokenHash(token)]);
  const r = rows[0];
  return r ? { code: r.public_code, startsAt: r.starts_at, partySize: r.party_size, status: r.status, timezone: r.timezone } : null;
}

export type CancelOutcome = "cancelled" | "already_cancelled" | "not_cancellable" | "too_late" | "not_found";

/** Cancela la reserva del enlace (hasta su hora de inicio). */
export async function cancelPublicReservation(
  orgSlug: string,
  establishmentSlug: string,
  token: string,
): Promise<CancelOutcome> {
  const slugs = [orgSlug, establishmentSlug].map((s) => s.toLowerCase());
  if (!slugs.every((s) => slugPattern.test(s)) || !CANCEL_TOKEN.test(token)) return "not_found";
  const { rows } = await getPool().query<{ outcome: CancelOutcome }>(
    "SELECT app.public_cancel($1, $2, $3) AS outcome",
    [...slugs, tokenHash(token)],
  );
  return rows[0]!.outcome;
}


// ---------------------------------------------------------------------------
// Lista de espera desde la web (D-042)
// ---------------------------------------------------------------------------

export const publicWaitlistSchema = z
  .object({
    date: z.string().refine(isValidLocalDate, { message: "Fecha no válida" }),
    from: z.string().refine((v) => parseTime(v) !== null, { message: "Hora no válida" }),
    to: z.string().refine((v) => parseTime(v, true) !== null, { message: "Hora no válida" }),
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
    website: z.string().max(0, { message: "No se pudo procesar la solicitud" }),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  })
  .strict()
  .refine((v) => v.customerPhone !== "" || v.customerEmail !== "", {
    message: "Indica un teléfono o un correo para poder contactarte",
    path: ["customerPhone"],
  })
  .refine((v) => parseTime(v.to, true)! > parseTime(v.from)!, {
    message: "La franja debe terminar después de empezar",
    path: ["to"],
  });

/**
 * Franja que se propone para la lista de espera de un día: de la primera
 * apertura al último cierre de ese día (hora local), o null si no abre.
 */
export async function waitlistWindow(
  info: PublicBookingInfo,
  date: string,
): Promise<{ from: string; to: string } | null> {
  const a = await loadAvailability(getPool(), info, date);
  const intervals = a.intervals.filter((iv) => iv.start < a.dayEnd && iv.end > a.dayStart);
  if (intervals.length === 0) return null;
  const start = Math.max(a.dayStart, Math.min(...intervals.map((iv) => iv.start)));
  const end = Math.min(a.dayEnd, Math.max(...intervals.map((iv) => iv.end)));
  // «24:00» no cabe en un campo de hora: el fin del día se propone como 23:59.
  return { from: hhmm(start, info.timezone), to: end >= a.dayEnd ? "23:59" : hhmm(end, info.timezone) };
}

export interface PublicWaitlistResult {
  date: string;
  from: string;
  to: string;
  partySize: number;
  replayed: boolean;
}

/** Apunta al cliente en la lista de espera del día (con la reserva online activada). */
export async function joinPublicWaitlist(
  info: PublicBookingInfo,
  input: unknown,
  clientId: string,
  now = new Date(),
): Promise<PublicWaitlistResult> {
  const d = parseInput(publicWaitlistSchema, input);
  if (!partyAllowed(info, d.partySize)) {
    throw new ValidationError(`Online se admiten de ${info.minParty} a ${info.maxParty} comensales`);
  }
  const range = bookableDateRange(info, now);
  if (d.date < range.first || d.date > range.last) {
    throw new ValidationError("Elige una fecha dentro de los días que admite el restaurante");
  }
  // La franja tiene que coincidir con alguna apertura de ese día.
  const a = await loadAvailability(getPool(), info, d.date);
  const from = localToUtc(d.date, parseTime(d.from)!, info.timezone).getTime();
  const to = localToUtc(d.date, parseTime(d.to, true)!, info.timezone).getTime();
  if (!a.intervals.some((iv) => iv.start < to && iv.end > from)) {
    throw new ValidationError("El restaurante no abre en esa franja");
  }
  await enforceRateLimits(info, clientId, d.customerEmail || d.customerPhone);
  try {
    const { rows } = await getPool().query<{ replayed: boolean }>(
      "SELECT * FROM app.public_join_waitlist($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        info.establishmentId,
        d.date,
        parseTime(d.from)!,
        parseTime(d.to, true)!,
        d.partySize,
        d.customerName,
        d.customerPhone || null,
        d.customerEmail ? d.customerEmail.toLowerCase() : null,
        d.notes || null,
        d.idempotencyKey,
      ],
    );
    return { date: d.date, from: d.from, to: d.to, partySize: d.partySize, replayed: rows[0]!.replayed };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "P0001" && e.message && PUBLIC_ERRORS[e.message]) throw PUBLIC_ERRORS[e.message]!();
    if (isUniqueViolation(err, "waitlist_idempotency_unique")) {
      throw new ConflictError("Tu solicitud ya se está procesando. Revisa en unos segundos.");
    }
    throw err;
  }
}
