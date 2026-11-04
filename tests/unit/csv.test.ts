import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("CSV", () => {
  it("separa con punto y coma, comillas solo cuando hace falta y marca UTF-8", () => {
    const csv = toCsv(["Nombre", "Notas"], [["Ana", 'Dijo "hola"; mesa 4'], ["Luis", "línea 1\nlínea 2"]]);
    expect(csv.startsWith("﻿Nombre;Notas\r\n")).toBe(true);
    expect(csv).toContain('Ana;"Dijo ""hola""; mesa 4"\r\n');
    expect(csv).toContain('Luis;"línea 1\nlínea 2"\r\n');
  });

  it("neutraliza fórmulas en los textos, no en los números", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+34 600", "-1+1", "@SUM(A1)", "\tx", "\r=1"]) {
      expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(2.5)).toBe("2,5");
    expect(csvCell(0.1 + 0.2)).toBe("0,3");
  });

  it("vacíos para null y undefined; espacios al principio o al final, entre comillas", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(" hola ")).toBe('" hola "');
  });
});
