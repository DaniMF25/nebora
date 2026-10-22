import { describe, expect, it } from "vitest";
import {
  addDays,
  isOpenAt,
  isoWeekday,
  isValidLocalDate,
  localDateOf,
  localToUtc,
  parseTime,
  resolveOpeningIntervals,
  slotClosingTime,
  slotFromTimes,
  validateDaySlots,
  validateWeeklySlots,
  type Schedule,
} from "@/server/modules/schedules/time";

const MADRID = "Europe/Madrid";

describe("horas y turnos", () => {
  it("parsea horas y construye turnos, incluidos los que pasan de medianoche", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("24:00", true)).toBe(1440);
    expect(parseTime("9:30")).toBeNull();
    expect(slotFromTimes("13:00", "16:00")).toEqual({ opensMinute: 780, durationMinutes: 180 });
    expect(slotFromTimes("20:00", "02:00")).toEqual({ opensMinute: 1200, durationMinutes: 360 });
    expect(slotFromTimes("00:00", "24:00")).toEqual({ opensMinute: 0, durationMinutes: 1440 });
    expect(slotFromTimes("10:00", "10:00")).toBeNull();
    expect(slotClosingTime({ opensMinute: 1200, durationMinutes: 360 })).toBe("02:00");
    expect(slotClosingTime({ opensMinute: 1200, durationMinutes: 240 })).toBe("24:00");
  });

  it("detecta solapes, también el cruce del domingo al lunes", () => {
    const lunch = { weekday: 1, ...slotFromTimes("13:00", "16:00")! };
    const dinner = { weekday: 1, ...slotFromTimes("20:00", "23:30")! };
    expect(validateWeeklySlots([lunch, dinner])).toBeNull();
    expect(validateWeeklySlots([lunch, { weekday: 1, ...slotFromTimes("15:00", "17:00")! }])).toMatch(/solapan/);
    // Lunes 22:00–03:00 se solapa con martes 02:00–04:00.
    expect(
      validateWeeklySlots([
        { weekday: 1, ...slotFromTimes("22:00", "03:00")! },
        { weekday: 2, ...slotFromTimes("02:00", "04:00")! },
      ]),
    ).toMatch(/solapan/);
    // Domingo 22:00–03:00 se solapa con lunes 01:00–02:00.
    expect(
      validateWeeklySlots([
        { weekday: 7, ...slotFromTimes("22:00", "03:00")! },
        { weekday: 1, ...slotFromTimes("01:00", "02:00")! },
      ]),
    ).toMatch(/solapan/);
    expect(validateWeeklySlots([{ weekday: 8, opensMinute: 0, durationMinutes: 10 }])).toMatch(/Día/);
    expect(validateWeeklySlots(Array.from({ length: 7 }, (_, i) => ({ weekday: 1, opensMinute: i * 60, durationMinutes: 30 })))).toMatch(/Máximo/);
    expect(validateDaySlots([{ opensMinute: 600, durationMinutes: 120 }, { opensMinute: 700, durationMinutes: 10 }])).toMatch(/solapan/);
  });
});

describe("fechas locales y zona horaria", () => {
  it("valida fechas y calcula el día ISO de la semana", () => {
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isoWeekday("2026-10-26")).toBe(1); // lunes
    expect(isoWeekday("2026-11-01")).toBe(7); // domingo
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("convierte hora local de Madrid a UTC en invierno y en verano", () => {
    expect(localToUtc("2026-01-15", 13 * 60, MADRID).toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(localToUtc("2026-07-15", 13 * 60, MADRID).toISOString()).toBe("2026-07-15T11:00:00.000Z");
    expect(localToUtc("2026-07-15", 25 * 60, MADRID).toISOString()).toBe("2026-07-15T23:00:00.000Z");
  });

  it("gestiona los cambios de hora", () => {
    // 29/03/2026: a las 02:00 pasan a ser las 03:00 (las 02:30 no existen).
    expect(localToUtc("2026-03-29", 150, MADRID).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(localToUtc("2026-03-29", 180, MADRID).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    // 25/10/2026: a las 03:00 vuelven a ser las 02:00.
    expect(localToUtc("2026-10-25", 240, MADRID).toISOString()).toBe("2026-10-25T03:00:00.000Z");
    expect(localDateOf(new Date("2026-10-24T22:30:00Z"), MADRID)).toBe("2026-10-25");
  });
});

describe("intervalos de apertura", () => {
  const schedule: Schedule = {
    weekly: [
      { weekday: 6, ...slotFromTimes("20:00", "02:00")! }, // sábado noche
      { weekday: 7, ...slotFromTimes("13:00", "16:00")! }, // domingo mediodía
    ],
    exceptions: [],
  };

  it("un turno nocturno durante el cambio de hora dura una hora más en tiempo real", () => {
    // Sábado 24/10/2026 20:00 CEST → domingo 25/10 02:00 CET = 7 horas reales.
    const ivs = resolveOpeningIntervals(schedule, MADRID, "2026-10-24", 1);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.start.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(ivs[0]!.end.toISOString()).toBe("2026-10-25T01:00:00.000Z");
  });

  it("incluye la parte del día anterior que pasa de medianoche", () => {
    const ivs = resolveOpeningIntervals(schedule, MADRID, "2026-10-25", 1);
    expect(ivs.map((i) => i.start.toISOString())).toEqual(["2026-10-24T18:00:00.000Z", "2026-10-25T12:00:00.000Z"]);
    expect(isOpenAt(schedule, MADRID, new Date("2026-10-25T00:30:00Z"))).toBe(true); // 01:30 local del domingo
    expect(isOpenAt(schedule, MADRID, new Date("2026-10-25T02:00:00Z"))).toBe(false);
    expect(isOpenAt(schedule, MADRID, new Date("2026-10-25T12:00:00Z"))).toBe(true);
    expect(isOpenAt(schedule, MADRID, new Date("2026-10-25T15:00:00Z"))).toBe(false); // cierre exclusivo
  });

  it("las excepciones sustituyen el horario de ese día", () => {
    const withExceptions: Schedule = {
      ...schedule,
      exceptions: [
        { date: "2026-10-24", closed: true, slots: [] },
        { date: "2026-10-25", closed: false, slots: [slotFromTimes("10:00", "12:00")!] },
      ],
    };
    const ivs = resolveOpeningIntervals(withExceptions, MADRID, "2026-10-24", 2);
    expect(ivs.map((i) => [i.start.toISOString(), i.end.toISOString()])).toEqual([
      ["2026-10-25T09:00:00.000Z", "2026-10-25T11:00:00.000Z"],
    ]);
  });

  it("fusiona turnos contiguos", () => {
    const contiguous: Schedule = {
      weekly: [
        { weekday: 1, ...slotFromTimes("10:00", "14:00")! },
        { weekday: 1, ...slotFromTimes("14:00", "18:00")! },
      ],
      exceptions: [],
    };
    const ivs = resolveOpeningIntervals(contiguous, MADRID, "2026-10-26", 1);
    expect(ivs).toHaveLength(1);
    expect(ivs[0]!.end.getTime() - ivs[0]!.start.getTime()).toBe(8 * 3600 * 1000);
  });
});
