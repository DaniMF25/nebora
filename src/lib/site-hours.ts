/** Horario semanal habitual en formato legible para la página pública. */

export interface WeeklySlot {
  weekday: number; // ISO: 1 = lunes … 7 = domingo
  opensMinute: number;
  durationMinutes: number;
}

export interface HoursLine {
  days: string;
  slots: string[];
}

const SPANISH = { shortDays: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"], and: "y" } as const;

function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Agrupa los días consecutivos con los mismos turnos: «Lun – Vie» con
 * «13:00 – 16:00», «20:00 – 23:30». Los días sin turnos no aparecen.
 */
export function groupOpeningHours(
  slots: readonly WeeklySlot[],
  words: { shortDays: readonly string[]; and: string } = SPANISH,
): HoursLine[] {
  const SHORT_DAYS = words.shortDays;
  const byDay = new Map<number, string[]>();
  for (const s of [...slots].sort((a, b) => a.weekday - b.weekday || a.opensMinute - b.opensMinute)) {
    const label = `${hhmm(s.opensMinute)} – ${hhmm(s.opensMinute + s.durationMinutes)}`;
    (byDay.get(s.weekday) ?? byDay.set(s.weekday, []).get(s.weekday)!).push(label);
  }
  const lines: { from: number; to: number; slots: string[] }[] = [];
  for (let day = 1; day <= 7; day++) {
    const daySlots = byDay.get(day);
    if (!daySlots) continue;
    const last = lines.at(-1);
    if (last && last.to === day - 1 && last.slots.join("|") === daySlots.join("|")) last.to = day;
    else lines.push({ from: day, to: day, slots: daySlots });
  }
  return lines.map((l) => ({
    days:
      l.from === l.to
        ? SHORT_DAYS[l.from - 1]!
        : l.to === l.from + 1
          ? `${SHORT_DAYS[l.from - 1]} ${words.and} ${SHORT_DAYS[l.to - 1]}`
          : `${SHORT_DAYS[l.from - 1]} – ${SHORT_DAYS[l.to - 1]}`,
    slots: l.slots,
  }));
}
