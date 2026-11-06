import { describe, expect, it } from "vitest";
import { formatDailyPrice, formatPrice, PLAN_INFO } from "@/lib/plans";

const plain = (s: string) => s.replace(/\s/g, " ");

// Precios de los planes (D-067): una sola fuente para la web y el panel.
describe("precios de los planes", () => {
  it("Básico 14,99 €, Avanzado 24,99 € y PRO 34,99 €, en orden creciente", () => {
    expect(PLAN_INFO.map((p) => [p.id, plain(formatPrice(p.monthlyPrice))])).toEqual([
      ["basic", "14,99 €"],
      ["advanced", "24,99 €"],
      ["pro", "34,99 €"],
    ]);
    expect(PLAN_INFO.filter((p) => p.recommended).map((p) => p.id)).toEqual(["pro"]);
  });

  it("el precio al día es el mensual por 12 entre 365, al céntimo", () => {
    expect(PLAN_INFO.map((p) => plain(formatDailyPrice(p.monthlyPrice)))).toEqual(["0,49 €", "0,82 €", "1,15 €"]);
  });
});
