/**
 * Lógica pura de horarios: sin acceso a BD, probada con pruebas unitarias.
 *
 * Convenciones:
 *  - Una fecha local es "YYYY-MM-DD" en la zona horaria del establecimiento.
 *  - Un turno es { opensMinute (0..1439), durationMinutes (1..1440) } en hora local.
 *    Si opens + duration > 1440 el turno termina al día siguiente.
 *  - weekday es ISO: 1 = lunes … 7 = domingo.
 */

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
export const MAX_SLOTS_PER_DAY = 6;

export interface Slot {
  opensMinute: number;
  durationMinutes: number;
}

export interface WeeklySlot extends Slot {
  weekday: number;
}

export interface DateException {
  date: string;
  closed: boolean;
  slots: Slot[];
  note?: string | null;
}

export interface Schedule {
  weekly: WeeklySlot[];
  exceptions: DateException[];
}

export interface Interval {
  start: Date;
  end: Date;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "HH:MM" → minutos. Acepta "24:00" solo si `allowEndOfDay`. */
export function parseTime(value: string, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === "24:00") return MINUTES_PER_DAY;
  const m = TIME_PATTERN.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatMinutes(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (minutes === MINUTES_PER_DAY) return "24:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Construye un turno desde horas de apertura y cierre. Si el cierre es anterior
 * a la apertura, el turno cruza la medianoche. Apertura == cierre no es válido
 * (para 24 h usar 00:00–24:00).
 */
export function slotFromTimes(opens: string, closes: string): Slot | null {
  const o = parseTime(opens);
  const c = parseTime(closes, true);
  if (o === null || c === null || o === c) return null;
  const duration = c > o ? c - o : c + MINUTES_PER_DAY - o;
  if (duration < 1 || duration > MINUTES_PER_DAY) return null;
  return { opensMinute: o, durationMinutes: duration };
}

/** Hora de cierre local ("24:00" si cierra justo a medianoche). */
export function slotClosingTime(slot: Slot): string {
  return formatMinutes(slot.opensMinute + slot.durationMinutes);
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/** Devuelve un mensaje de error o null si el horario semanal es válido. */
export function validateWeeklySlots(slots: WeeklySlot[]): string | null {
  const perDay = new Map<number, number>();
  const ranges: { range: [number, number]; index: number }[] = [];
  for (const [index, s] of slots.entries()) {
    if (!Number.isInteger(s.weekday) || s.weekday < 1 || s.weekday > 7) return "Día de la semana no válido";
    if (!isValidSlot(s)) return "Turno no válido";
    perDay.set(s.weekday, (perDay.get(s.weekday) ?? 0) + 1);
    if (perDay.get(s.weekday)! > MAX_SLOTS_PER_DAY) return `Máximo ${MAX_SLOTS_PER_DAY} turnos por día`;
    const start = (s.weekday - 1) * MINUTES_PER_DAY + s.opensMinute;
    const end = start + s.durationMinutes;
    ranges.push({ range: [start, Math.min(end, MINUTES_PER_WEEK)], index });
    // Un turno del domingo que pasa de medianoche ocupa el principio del lunes.
    if (end > MINUTES_PER_WEEK) ranges.push({ range: [0, end - MINUTES_PER_WEEK], index });
  }
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i]!.index !== ranges[j]!.index && rangesOverlap(ranges[i]!.range, ranges[j]!.range)) {
        return "Hay turnos que se solapan";
      }
    }
  }
  return null;
}

export function validateDaySlots(slots: Slot[]): string | null {
  if (slots.length > MAX_SLOTS_PER_DAY) return `Máximo ${MAX_SLOTS_PER_DAY} turnos por día`;
  for (const s of slots) if (!isValidSlot(s)) return "Turno no válido";
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (rangesOverlap([a.opensMinute, a.opensMinute + a.durationMinutes], [b.opensMinute, b.opensMinute + b.durationMinutes])) {
        return "Hay turnos que se solapan";
      }
    }
  }
  return null;
}

function isValidSlot(s: Slot): boolean {
  return (
    Number.isInteger(s.opensMinute) &&
    Number.isInteger(s.durationMinutes) &&
    s.opensMinute >= 0 &&
    s.opensMinute < MINUTES_PER_DAY &&
    s.durationMinutes >= 1 &&
    s.durationMinutes <= MINUTES_PER_DAY
  );
}

// ---------------------------------------------------------------------------
// Fechas locales y zonas horarias
// ---------------------------------------------------------------------------

export function isValidLocalDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function dateParts(date: string): [number, number, number] {
  const m = DATE_PATTERN.exec(date);
  if (!m) throw new Error(`Fecha local no válida: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día ISO de la semana de una fecha local (1 = lunes … 7 = domingo). */
export function isoWeekday(date: string): number {
  const [y, m, d] = dateParts(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClockParts(instantMs: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instantMs))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** Desfase (ms) de la zona respecto a UTC en un instante dado. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = wallClockParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Instante UTC de una hora local (fecha + minutos desde su medianoche, pueden
 * superar 1440). Horas inexistentes por el cambio de hora de primavera se
 * desplazan hacia delante; en horas repetidas (otoño) se usa la segunda.
 */
export function localToUtc(date: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateParts(date);
  const local = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const guess = local - offsetMs(local, timeZone);
  return new Date(local - offsetMs(guess, timeZone));
}

/** Fecha local ("YYYY-MM-DD") de un instante en una zona horaria. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = wallClockParts(instant.getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Turnos que empiezan en una fecha local: la excepción sustituye al horario semanal. */
export function slotsForDate(schedule: Schedule, date: string): Slot[] {
  const exception = schedule.exceptions.find((e) => e.date === date);
  if (exception) return exception.closed ? [] : exception.slots;
  const weekday = isoWeekday(date);
  return schedule.weekly.filter((s) => s.weekday === weekday);
}

/**
 * Intervalos reales (UTC) de apertura que intersecan los `days` días locales a
 * partir de `fromDate`. Incluye turnos del día anterior que pasan de medianoche
 * y fusiona intervalos contiguos o solapados.
 */
export function resolveOpeningIntervals(
  schedule: Schedule,
  timeZone: string,
  fromDate: string,
  days: number,
): Interval[] {
  const windowStart = localToUtc(fromDate, 0, timeZone).getTime();
  const windowEnd = localToUtc(addDays(fromDate, days), 0, timeZone).getTime();
  const raw: Interval[] = [];
  for (let i = -1; i < days; i++) {
    const date = addDays(fromDate, i);
    for (const s of slotsForDate(schedule, date)) {
      raw.push({
        start: localToUtc(date, s.opensMinute, timeZone),
        end: localToUtc(date, s.opensMinute + s.durationMinutes, timeZone),
      });
    }
  }
  raw.sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged.filter((iv) => iv.end.getTime() > windowStart && iv.start.getTime() < windowEnd);
}

export function isOpenAt(schedule: Schedule, timeZone: string, instant: Date): boolean {
  const date = localDateOf(instant, timeZone);
  const t = instant.getTime();
  return resolveOpeningIntervals(schedule, timeZone, date, 1).some(
    (iv) => iv.start.getTime() <= t && t < iv.end.getTime(),
  );
}
