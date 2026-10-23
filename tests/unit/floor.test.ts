import { describe, expect, it } from "vitest";
import { findFreeSpot, insidePlan, rectsOverlap } from "@/lib/floor";

describe("geometría del plano", () => {
  it("las mesas contiguas no se solapan; las superpuestas sí", () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    expect(rectsOverlap(a, { x: 2, y: 0, width: 2, height: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 2, width: 2, height: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 1, y: 1, width: 2, height: 2 })).toBe(true);
    expect(rectsOverlap(a, { x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });

  it("comprueba los límites del plano", () => {
    expect(insidePlan({ x: 14, y: 8, width: 2, height: 2 }, 16, 10)).toBe(true);
    expect(insidePlan({ x: 15, y: 8, width: 2, height: 2 }, 16, 10)).toBe(false);
    expect(insidePlan({ x: -1, y: 0, width: 2, height: 2 }, 16, 10)).toBe(false);
  });

  it("encuentra el primer hueco libre o null si no cabe", () => {
    expect(findFreeSpot(6, 4, [], 2, 2)).toEqual({ x: 0, y: 0 });
    expect(findFreeSpot(6, 4, [{ x: 0, y: 0, width: 2, height: 2 }], 2, 2)).toEqual({ x: 2, y: 0 });
    const full = [0, 2, 4].flatMap((x) => [0, 2].map((y) => ({ x, y, width: 2, height: 2 })));
    expect(findFreeSpot(6, 4, full, 2, 2)).toBeNull();
    expect(findFreeSpot(6, 4, full.slice(1), 3, 2)).toBeNull();
    expect(findFreeSpot(6, 4, [], 7, 1)).toBeNull();
  });
});
