import { describe, expect, it } from "vitest";
import {
  formatQuantity,
  fromNumericString,
  parseQuantity,
  toBase,
  toNumericString,
  unitsFor,
} from "@/lib/quantity";

describe("cantidades de inventario", () => {
  it("parsea cantidades positivas con hasta 3 decimales", () => {
    expect(parseQuantity("1,5")).toBe(1500n);
    expect(parseQuantity("0.001")).toBe(1n);
    expect(parseQuantity("12")).toBe(12000n);
    for (const bad of ["0", "-1", "1,2345", "abc", "", "1e3", "999999999999"]) expect(parseQuantity(bad), bad).toBeNull();
  });

  it("convierte a la unidad base sin errores de redondeo", () => {
    expect(toBase(parseQuantity("1,5")!, "kg", "g")).toBe(1_500_000n); // 1500 g
    expect(toBase(parseQuantity("0,1")!, "l", "ml")).toBe(100_000n); // 100 ml
    expect(toBase(parseQuantity("3")!, "cl", "ml")).toBe(30_000n);
    expect(toBase(parseQuantity("1")!, "kg", "ml")).toBeNull(); // unidad incompatible
    // 0,1 + 0,2 en coma flotante no da 0,3; con milésimas enteras sí.
    expect(toNumericString(parseQuantity("0,1")! + parseQuantity("0,2")!)).toBe("0.300");
  });

  it("convierte entre milésimas y literales numeric", () => {
    expect(toNumericString(-1_500_000n)).toBe("-1500.000");
    expect(toNumericString(5n)).toBe("0.005");
    expect(fromNumericString("1500.000")).toBe(1_500_000n);
    expect(fromNumericString("-0.250")).toBe(-250n);
  });

  it("presenta cantidades legibles y lista unidades compatibles", () => {
    expect(formatQuantity("1500.000", "g")).toBe("1,5 kg");
    expect(formatQuantity("250.000", "ml")).toBe("250 ml");
    expect(formatQuantity("3.000", "unit")).toBe("3 ud.");
    expect(unitsFor("ml")).toEqual(["ml", "cl", "l"]);
  });
});
