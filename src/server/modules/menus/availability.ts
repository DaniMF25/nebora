/**
 * Horario de una carta (D-036): lógica pura, sin BD. Reutiliza el formato y la
 * lógica del horario de apertura (turnos semanales en hora local que pueden
 * cruzar la medianoche, cambios de hora incluidos).
 */
import { groupOpeningHours } from "@/lib/site-hours";
import { formatMinutes, isOpenAt, slotFromTimes, validateWeeklySlots, type WeeklySlot } from "../schedules/time";

/** Franjas como se editan: días de la semana con la misma hora de inicio y fin. */
export interface AvailabilityRule {
  days: number[];
  opens: string;
  closes: string;
}

export const MAX_AVAILABILITY_RULES = 7;

/** Franjas → turnos semanales. Devuelve un mensaje si no son válidas. */
export function rulesToSlots(rules: AvailabilityRule[]): WeeklySlot[] | string {
  if (rules.length === 0) return "Añade al menos una franja o elige «Siempre disponible»";
  if (rules.length > MAX_AVAILABILITY_RULES) return `Como máximo ${MAX_AVAILABILITY_RULES} franjas`;
  const slots: WeeklySlot[] = [];
  for (const [n, rule] of rules.entries()) {
    if (rule.days.length === 0) return `Franja ${n + 1}: marca al menos un día`;
    const slot = slotFromTimes(rule.opens, rule.closes);
    if (!slot) return `Franja ${n + 1}: indica una hora de inicio y otra de fin distintas`;
    for (const weekday of rule.days) slots.push({ weekday, ...slot });
  }
  const problem = validateWeeklySlots(slots);
  if (problem) return problem === "Hay turnos que se solapan" ? "Hay franjas que se solapan algún día" : problem;
  return slots.sort((a, b) => a.weekday - b.weekday || a.opensMinute - b.opensMinute);
}

/** Turnos semanales → franjas (agrupa los días con el mismo horario), para editar. */
export function slotsToRules(slots: readonly WeeklySlot[]): AvailabilityRule[] {
  const rules = new Map<string, AvailabilityRule>();
  for (const s of [...slots].sort((a, b) => a.opensMinute - b.opensMinute || a.weekday - b.weekday)) {
    const opens = formatMinutes(s.opensMinute);
    // «24:00» no cabe en un campo de hora: fin a medianoche se edita como 00:00.
    const closes = formatMinutes((s.opensMinute + s.durationMinutes) % 1440);
    const key = `${opens}-${closes}`;
    const rule = rules.get(key) ?? rules.set(key, { days: [], opens, closes }).get(key)!;
    rule.days.push(s.weekday);
  }
  return [...rules.values()];
}

/** ¿Se sirve la carta en ese instante? Sin horario (null) se sirve siempre. */
export function isMenuAvailable(availability: readonly WeeklySlot[] | null, timeZone: string, at: Date): boolean {
  if (!availability) return true;
  return isOpenAt({ weekly: [...availability], exceptions: [] }, timeZone, at);
}

export interface MenuChoice {
  slug: string;
  availability: WeeklySlot[] | null;
  featured: boolean;
}

/**
 * Carta que toca mostrar ahora entre las publicadas de un local:
 *  1. una con horario que se sirva ahora (la destacada si es una de ellas), así
 *     «Desayunos 8–12» se impone a la carta de siempre por la mañana;
 *  2. si no, la destacada si se sirve ahora;
 *  3. si no, la primera que se sirva ahora;
 *  4. si no hay ninguna, la destacada (la página indica cuándo se sirve) o la primera.
 */
export function pickCurrentMenu<T extends MenuChoice>(menus: readonly T[], timeZone: string, at: Date): T | null {
  const now = menus.filter((m) => isMenuAvailable(m.availability, timeZone, at));
  const scheduled = now.filter((m) => m.availability);
  return (
    scheduled.find((m) => m.featured) ??
    scheduled[0] ??
    now.find((m) => m.featured) ??
    now[0] ??
    menus.find((m) => m.featured) ??
    menus[0] ??
    null
  );
}

/** Lo que muestran las páginas públicas sobre el horario de una carta y las demás. */
export interface MenuServing {
  /** Horario de esta carta («Lun – Vie 08:00 – 12:00»); null si se sirve siempre. */
  hours: string[] | null;
  availableNow: boolean;
  /** Cartas publicadas del local (solo si hay más de una). */
  menus: { slug: string; name: string; href: string; current: boolean; scheduledNow: boolean }[];
}

/**
 * Horario de la carta `currentSlug` y enlaces a las demás cartas publicadas del
 * local, con los nombres en `lang` y los días con `words` (textos públicos).
 */
export function menuServing(
  data: {
    timezone: string;
    menus: { slug: string; name: string; nameI18n: Partial<Record<string, string>>; availability: WeeklySlot[] | null }[];
  },
  currentSlug: string,
  lang: string,
  at: Date,
  hrefFor: (slug: string) => string,
  groupHours: (slots: WeeklySlot[]) => string[],
): MenuServing {
  const current = data.menus.find((m) => m.slug === currentSlug);
  return {
    hours: current?.availability ? groupHours(current.availability) : null,
    availableNow: current ? isMenuAvailable(current.availability, data.timezone, at) : true,
    menus:
      data.menus.length > 1
        ? data.menus.map((m) => ({
            slug: m.slug,
            name: m.nameI18n[lang] || m.name,
            href: hrefFor(m.slug),
            current: m.slug === currentSlug,
            scheduledNow: m.availability !== null && isMenuAvailable(m.availability, data.timezone, at),
          }))
        : [],
  };
}

/** Horario de la carta en una línea para el panel: «Lun – Vie 08:00 – 12:00 · Sáb y Dom 09:00 – 13:00». */
export function describeAvailability(slots: readonly WeeklySlot[]): string {
  return groupOpeningHours(slots)
    .map((l) => `${l.days} ${l.slots.join(", ")}`)
    .join(" · ");
}
