import { describe, expect, it } from "vitest";
import { groupOpeningHours } from "@/lib/site-hours";

const slot = (weekday: number, opens: number, duration: number) => ({ weekday, opensMinute: opens, durationMinutes: duration });

describe("groupOpeningHours", () => {
  it("agrupa días consecutivos con los mismos turnos", () => {
    const week = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [slot(d, 810, 150), slot(d, 1200, 270)]);
    expect(groupOpeningHours(week)).toEqual([{ days: "Lun – Dom", slots: ["13:30 – 16:00", "20:00 – 00:30"] }]);
  });

  it("separa los días distintos, omite los cerrados y ordena los turnos", () => {
    expect(
      groupOpeningHours([slot(6, 1200, 240), slot(2, 1200, 180), slot(1, 1200, 180), slot(2, 780, 180), slot(7, 780, 180)]),
    ).toEqual([
      { days: "Lun", slots: ["20:00 – 23:00"] },
      { days: "Mar", slots: ["13:00 – 16:00", "20:00 – 23:00"] },
      { days: "Sáb", slots: ["20:00 – 00:00"] },
      { days: "Dom", slots: ["13:00 – 16:00"] },
    ]);
  });

  it("usa «y» para dos días seguidos y devuelve vacío sin horario", () => {
    expect(groupOpeningHours([slot(6, 600, 60), slot(7, 600, 60)])).toEqual([{ days: "Sáb y Dom", slots: ["10:00 – 11:00"] }]);
    expect(groupOpeningHours([])).toEqual([]);
  });
});
