import { describe, expect, it } from "vitest";
import { availableStarts, freeTables, rankTables, type SlotQuery } from "@/server/modules/public-booking/slots";

const H = 3_600_000;
const M = 60_000;

const tables = [
  { id: "t-big", minCapacity: 6, maxCapacity: 8 },
  { id: "t-2", minCapacity: 1, maxCapacity: 2 },
  { id: "t-4", minCapacity: 2, maxCapacity: 4 },
];

function query(over: Partial<SlotQuery> = {}): SlotQuery {
  return {
    intervals: [{ start: 13 * H, end: 16 * H }],
    dayStart: 0,
    dayEnd: 24 * H,
    durationMs: 90 * M,
    stepMs: 30 * M,
    earliest: 0,
    latest: 24 * H,
    tables,
    busy: [],
    party: 2,
    ...over,
  };
}

describe("reservas públicas: mesas y horas disponibles", () => {
  it("ordena las mesas por ajuste al grupo", () => {
    expect(rankTables(tables, 2).map((t) => t.id)).toEqual(["t-2", "t-4", "t-big"]);
    expect(rankTables(tables, 3).map((t) => t.id)).toEqual(["t-4", "t-big"]);
    expect(rankTables(tables, 7).map((t) => t.id)).toEqual(["t-big"]);
    expect(rankTables(tables, 9)).toEqual([]);
  });

  it("detecta mesas ocupadas con intervalos semiabiertos", () => {
    const busy = [{ tableId: "t-2", start: 13 * H, end: 14 * H }];
    expect(freeTables(tables, busy, 13 * H, 14 * H).map((t) => t.id)).not.toContain("t-2");
    expect(freeTables(tables, busy, 14 * H, 15 * H).map((t) => t.id)).toContain("t-2");
  });

  it("ofrece inicios que caben completos en el turno", () => {
    // 13:00–16:00 con 90 min y paso de 30: 13:00, 13:30, 14:00, 14:30.
    expect(availableStarts(query()).map((t) => t / H)).toEqual([13, 13.5, 14, 14.5]);
  });

  it("respeta antelación mínima, límite de días vista y el día local", () => {
    expect(availableStarts(query({ earliest: 13.6 * H })).map((t) => t / H)).toEqual([14, 14.5]);
    expect(availableStarts(query({ latest: 13.5 * H })).map((t) => t / H)).toEqual([13, 13.5]);
    // Un turno del día anterior que continúa en este no ofrece inicios previos al día.
    expect(availableStarts(query({ intervals: [{ start: -2 * H, end: 2 * H }] })).map((t) => t / H)).toEqual([0, 0.5]);
  });

  it("excluye horas sin ninguna mesa libre adecuada", () => {
    const busy = ["t-2", "t-4", "t-big"].map((tableId) => ({ tableId, start: 13 * H, end: 14 * H + 30 * M }));
    expect(availableStarts(query({ busy })).map((t) => t / H)).toEqual([14.5]);
    expect(availableStarts(query({ party: 12 }))).toEqual([]);
  });
});
