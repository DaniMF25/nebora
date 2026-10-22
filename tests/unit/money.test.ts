import { describe, expect, it } from "vitest";
import { centsToInput, formatEuros, parseEuroAmount } from "@/lib/money";

describe("importes", () => {
  it("convierte euros escritos a céntimos sin errores de coma flotante", () => {
    expect(parseEuroAmount("12,50")).toBe(1250);
    expect(parseEuroAmount("12.5")).toBe(1250);
    expect(parseEuroAmount("0,07")).toBe(7);
    expect(parseEuroAmount(" 9 € ")).toBe(900);
    expect(parseEuroAmount("19.99")).toBe(1999);
  });

  it("rechaza entradas no válidas", () => {
    for (const bad of ["", "-1", "1,234", "abc", "1e3", "12,", "99999999"]) expect(parseEuroAmount(bad), bad).toBeNull();
  });

  it("formatea en euros", () => {
    expect(formatEuros(1250).replace(/\s/g, " ")).toBe("12,50 €");
    expect(centsToInput(1205)).toBe("12,05");
  });
});
