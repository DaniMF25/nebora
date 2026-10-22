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

describe("costes unitarios", () => {
  it("convierte euros con hasta 4 decimales a céntimos exactos", async () => {
    const { parseEuroCost, formatCentsNumeric, centsNumericToInput } = await import("@/lib/money");
    expect(parseEuroCost("0,1875")).toBe("18.75");
    expect(parseEuroCost("12,5")).toBe("1250.00");
    expect(parseEuroCost("3")).toBe("300.00");
    expect(parseEuroCost("1,23456")).toBeNull();
    expect(parseEuroCost("-1")).toBeNull();
    expect(formatCentsNumeric("1234.5").replace(/\s/g, " ")).toBe("12,35 €");
    expect(centsNumericToInput("18.75")).toBe("0,1875");
  });
});
