import { describe, expect, it } from "vitest";
import {
  isMenuAvailable,
  pickCurrentMenu,
  rulesToSlots,
  slotsToRules,
  type MenuChoice,
} from "@/server/modules/menus/availability";
import type { WeeklySlot } from "@/server/modules/schedules/time";

const MADRID = "Europe/Madrid";
// 2026-11-02 es lunes; en noviembre Madrid está en UTC+1.
const at = (local: string) => new Date(`${local}+01:00`);

describe("franjas de una carta", () => {
  it("se convierten en turnos por día y vuelven a agruparse igual", () => {
    const slots = rulesToSlots([
      { days: [1, 2, 3, 4, 5], opens: "08:00", closes: "12:00" },
      { days: [6, 7], opens: "09:00", closes: "13:00" },
    ]);
    expect(slots).toHaveLength(7);
    expect((slots as WeeklySlot[])[0]).toEqual({ weekday: 1, opensMinute: 480, durationMinutes: 240 });
    expect(slotsToRules(slots as WeeklySlot[])).toEqual([
      { days: [1, 2, 3, 4, 5], opens: "08:00", closes: "12:00" },
      { days: [6, 7], opens: "09:00", closes: "13:00" },
    ]);
  });

  it("admite franjas que cruzan la medianoche y fin a las 00:00", () => {
    const slots = rulesToSlots([{ days: [5], opens: "22:00", closes: "00:00" }]) as WeeklySlot[];
    expect(slots).toEqual([{ weekday: 5, opensMinute: 1320, durationMinutes: 120 }]);
    expect(slotsToRules(slots)).toEqual([{ days: [5], opens: "22:00", closes: "00:00" }]);
  });

  it("rechaza franjas vacías, sin días, iguales o solapadas", () => {
    expect(rulesToSlots([])).toMatch(/al menos una franja/);
    expect(rulesToSlots([{ days: [], opens: "08:00", closes: "12:00" }])).toMatch(/Franja 1: marca al menos un día/);
    expect(rulesToSlots([{ days: [1], opens: "08:00", closes: "08:00" }])).toMatch(/Franja 1: indica/);
    expect(
      rulesToSlots([
        { days: [1, 2], opens: "08:00", closes: "12:00" },
        { days: [2], opens: "11:00", closes: "14:00" },
      ]),
    ).toBe("Hay franjas que se solapan algún día");
  });
});

describe("¿se sirve ahora?", () => {
  const breakfast = rulesToSlots([{ days: [1, 2, 3, 4, 5], opens: "08:00", closes: "12:00" }]) as WeeklySlot[];
  const lateNight = rulesToSlots([{ days: [6], opens: "23:00", closes: "02:00" }]) as WeeklySlot[];

  it("usa la hora local del establecimiento", () => {
    expect(isMenuAvailable(breakfast, MADRID, at("2026-11-02T08:00:00"))).toBe(true);
    expect(isMenuAvailable(breakfast, MADRID, at("2026-11-02T11:59:00"))).toBe(true);
    expect(isMenuAvailable(breakfast, MADRID, at("2026-11-02T12:00:00"))).toBe(false);
    expect(isMenuAvailable(breakfast, MADRID, at("2026-11-08T09:00:00"))).toBe(false); // domingo
    // La misma hora UTC en Nueva York no es la franja.
    expect(isMenuAvailable(breakfast, "America/New_York", at("2026-11-02T09:00:00"))).toBe(false);
  });

  it("una franja nocturna sigue al día siguiente", () => {
    expect(isMenuAvailable(lateNight, MADRID, at("2026-11-08T01:30:00"))).toBe(true); // domingo de madrugada
    expect(isMenuAvailable(lateNight, MADRID, at("2026-11-08T02:00:00"))).toBe(false);
  });

  it("sin horario se sirve siempre", () => {
    expect(isMenuAvailable(null, MADRID, at("2026-11-02T04:00:00"))).toBe(true);
  });
});

describe("carta del momento", () => {
  const breakfast: MenuChoice = {
    slug: "desayunos",
    featured: false,
    availability: rulesToSlots([{ days: [1, 2, 3, 4, 5], opens: "08:00", closes: "12:00" }]) as WeeklySlot[],
  };
  const lunch: MenuChoice = {
    slug: "mediodia",
    featured: true,
    availability: rulesToSlots([{ days: [1, 2, 3, 4, 5, 6, 7], opens: "13:00", closes: "16:00" }]) as WeeklySlot[],
  };
  const main: MenuChoice = { slug: "carta", featured: true, availability: null };
  const wines: MenuChoice = { slug: "vinos", featured: false, availability: null };
  const pick = (menus: MenuChoice[], local: string) => pickCurrentMenu(menus, MADRID, at(local))?.slug ?? null;

  it("una carta con horario que se sirve ahora se impone a la de siempre", () => {
    expect(pick([main, breakfast, wines], "2026-11-02T09:00:00")).toBe("desayunos");
    expect(pick([main, breakfast, wines], "2026-11-02T13:00:00")).toBe("carta");
  });

  it("sin cartas con horario activas: la destacada, o la primera disponible", () => {
    expect(pick([wines, main], "2026-11-02T20:00:00")).toBe("carta");
    expect(pick([breakfast, wines, lunch], "2026-11-02T20:00:00")).toBe("vinos");
  });

  it("si ninguna se sirve ahora: la destacada (la página dice cuándo) o la primera", () => {
    expect(pick([breakfast, lunch], "2026-11-02T20:00:00")).toBe("mediodia");
    expect(pick([breakfast], "2026-11-02T20:00:00")).toBe("desayunos");
    expect(pick([], "2026-11-02T20:00:00")).toBeNull();
  });

  it("un local con una sola carta sin horario sigue igual", () => {
    expect(pick([{ ...main, featured: false }], "2026-11-02T04:00:00")).toBe("carta");
  });
});
